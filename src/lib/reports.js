/**
 * Reports for the accountant and SARS, built from the salon's data. One report object drives the
 * screen, the printout/PDF and the CSV download, so they always agree.
 *
 * Report: { title, subtitle, sections: [{ heading, note?, columns: [{ label, num? }], rows: [[…]], foot?: […] }], notes: [] }
 * Money columns (num: true) hold plain numbers; they're formatted when shown.
 */
import { monthLabel, monthRange, shortDate, shiftMonth, totals, METHODS } from './format.js'
import { taxYear, taxYearLabel } from './payroll.js'

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const sum = (xs, f) => r2(xs.reduce((s, x) => s + (Number(f(x)) || 0), 0))
const longDate = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const nameOf = (employees, id, fallback = '') => employees.find((e) => e.id === id)?.name || fallback

/** Employer's UIF on a payslip (matches the staff member's 1%, capped). */
export const employerUif = (p) => Number(p.details?.employerUif ?? p.uif) || 0

/** Salary and other pay (IRP5 code 3601) vs commission (3606), from the saved payslip. */
function splitEarnings(p) {
  const earnings = p.details?.earnings
  if (!Array.isArray(earnings)) return { salary: p.gross, commission: 0 }
  const commission = sum(earnings.filter((e) => /commission/i.test(e.label || '')), (e) => e.amount)
  return { salary: r2(p.gross - commission), commission }
}

/** The 7th of the month after the pay date: when the EMP201 is due. */
function emp201Due(payDate) {
  if (!payDate) return ''
  const next = shiftMonth(payDate.slice(0, 7), 1)
  return longDate(`${next}-07`)
}

/**
 * Month-end pack for one business month: takings (by method and team member), unpaid visits,
 * the payroll and the EMP201 figures (PAYE + UIF).
 */
export function monthEndReport({ month, appts, employees, payslips, company, startDay }) {
  const range = monthRange(month, startDay)
  const list = appts.filter((a) => a.month === month)
  const t = totals(list)
  const byEmp = new Map()
  for (const a of list) {
    if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, [])
    byEmp.get(a.employeeId).push(a)
  }
  const team = [...byEmp].map(([id, xs]) => ({ name: nameOf(employees, id, xs[0].employeeName), t: totals(xs) })).sort((a, b) => b.t.total - a.t.total)
  const unpaid = list.filter((a) => a.status === 'Unpaid').sort((a, b) => (a.date < b.date ? -1 : 1))
  const slips = payslips.filter((p) => p.month === month).sort((a, b) => nameOf(employees, a.employeeId, a.employeeName).localeCompare(nameOf(employees, b.employeeId, b.employeeName)))
  const worked = new Set(list.map((a) => a.employeeId))
  const missing = employees.filter((e) => (e.active || worked.has(e.id)) && !slips.some((p) => p.employeeId === e.id))
  const paye = sum(slips, (p) => p.paye)
  const uif = sum(slips, (p) => p.uif)
  const uifEmployer = sum(slips, employerUif)
  const payDates = [...new Set(slips.map((p) => p.payDate).filter(Boolean))].sort()

  const sections = [
    {
      heading: 'Takings',
      columns: [{ label: '' }, { label: 'Appointments', num: false }, { label: 'Amount', num: true }],
      rows: [
        ['Total takings', t.count, t.total],
        ['Paid', t.paidCount, t.paid],
        ['Unpaid (owed)', t.unpaidCount, t.unpaid],
        ...(t.writtenOffCount ? [['Written off (not counted)', t.writtenOffCount, t.writtenOff]] : []),
        ...METHODS.map((m) => [`Paid with ${m}`, list.filter((a) => a.method === m).length, t[m]]),
      ],
    },
    {
      heading: 'By team member',
      columns: [{ label: 'Team member' }, { label: 'Appointments' }, { label: 'Takings', num: true }, { label: 'Paid', num: true }, { label: 'Unpaid', num: true }],
      rows: team.map((x) => [x.name, x.t.count, x.t.total, x.t.paid, x.t.unpaid]),
      foot: ['Total', t.count, t.total, t.paid, t.unpaid],
    },
    {
      heading: `Unpaid appointments (${unpaid.length})`,
      columns: [{ label: 'Date' }, { label: 'Client' }, { label: 'Team member' }, { label: 'Service' }, { label: 'Amount', num: true }],
      rows: unpaid.map((a) => [shortDate(a.date), a.client, nameOf(employees, a.employeeId, a.employeeName), a.service, a.amount]),
      foot: unpaid.length ? ['Total', '', '', '', t.unpaid] : null,
      empty: 'Nothing unpaid 🎉',
    },
    {
      heading: 'Payroll',
      note: missing.length ? `No payslip saved yet for ${missing.map((e) => e.name).join(', ')}.` : '',
      columns: [{ label: 'Team member' }, { label: 'Pay date' }, { label: 'Gross', num: true }, { label: 'PAYE', num: true }, { label: 'UIF (staff)', num: true },
        { label: 'UIF (employer)', num: true }, { label: 'Other deductions', num: true }, { label: 'Net pay', num: true }],
      rows: slips.map((p) => [nameOf(employees, p.employeeId, p.employeeName), p.payDate ? shortDate(p.payDate) : '', p.gross, p.paye, p.uif, employerUif(p), p.deductions, p.net]),
      foot: slips.length ? ['Total', '', sum(slips, (p) => p.gross), paye, uif, uifEmployer, sum(slips, (p) => p.deductions), sum(slips, (p) => p.net)] : null,
      empty: 'No payslips saved for this month yet.',
    },
    {
      heading: 'EMP201 — to SARS',
      note: payDates.length ? `For pay made on ${payDates.map(longDate).join(', ')}. Due by ${emp201Due(payDates[payDates.length - 1])}.` : '',
      columns: [{ label: '' }, { label: 'Amount', num: true }],
      rows: [
        ['PAYE', paye],
        ['UIF (staff 1% + employer 1%)', r2(uif + uifEmployer)],
        ['SDL (only when the payroll is over R500 000 a year)', 0],
      ],
      foot: ['Total to pay SARS', r2(paye + uif + uifEmployer)],
    },
  ]
  return {
    kind: 'month-end',
    title: `Month-end pack · ${monthLabel(month)}`,
    subtitle: `${company?.name || 'Little Lash Lounge'} · takings ${shortDate(range.from)} ${range.from.slice(0, 4)} – ${shortDate(range.to)} ${range.to.slice(0, 4)}`,
    sections,
    notes: ['Figures from the Little Lash Lounge app. Payroll figures come from the saved payslips.'],
    fileName: `Month-end ${monthLabel(month)}`,
  }
}

/** Tax years (ending February) that have payslips, newest first. */
export function taxYearsWithPayslips(payslips, startDay) {
  const years = new Set(payslips.map((p) => taxYear(p.payDate || monthRange(p.month, startDay).to)))
  return [...years].sort((a, b) => b - a)
}

/**
 * Tax-year totals per team member for IRP5 certificates and the EMP501 reconciliation
 * (March to February), plus the month-by-month EMP201 figures.
 */
export function taxYearReport({ year, payslips, employees, company, startDay }) {
  const inYear = payslips.filter((p) => taxYear(p.payDate || monthRange(p.month, startDay).to) === year)
  const byEmp = new Map()
  for (const p of inYear) {
    if (!byEmp.has(p.employeeId)) byEmp.set(p.employeeId, [])
    byEmp.get(p.employeeId).push(p)
  }
  const people = [...byEmp].map(([id, slips]) => {
    const emp = employees.find((e) => e.id === id)
    const split = slips.map(splitEarnings)
    return {
      name: emp?.pay?.fullName || emp?.name || slips[0].employeeName,
      taxNumber: emp?.pay?.taxNumber || '',
      idNumber: emp?.pay?.idNumber || '',
      months: slips.length,
      salary: sum(split, (s) => s.salary),
      commission: sum(split, (s) => s.commission),
      gross: sum(slips, (p) => p.gross),
      paye: sum(slips, (p) => p.paye),
      uif: sum(slips, (p) => p.uif),
      uifEmployer: sum(slips, employerUif),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const byMonth = new Map()
  for (const p of inYear) {
    const m = (p.payDate || monthRange(p.month, startDay).to).slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push(p)
  }
  const months = [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1))
  const total = (f) => sum(people, f)
  return {
    kind: 'tax-year',
    title: `Tax year ${taxYearLabel(year)} · IRP5 / EMP501`,
    subtitle: `${company?.name || 'Little Lash Lounge'}${company?.payeRef ? ` · PAYE ref ${company.payeRef}` : ''} · 1 March ${year - 1} – 28 February ${year}`,
    sections: [
      {
        heading: 'Per team member (for the IRP5 certificates)',
        columns: [{ label: 'Team member' }, { label: 'Tax number' }, { label: 'Months' }, { label: 'Salary & other (3601)', num: true },
          { label: 'Commission (3606)', num: true }, { label: 'Gross', num: true }, { label: 'PAYE (4102)', num: true }, { label: 'UIF staff + employer (4141)', num: true }],
        rows: people.map((x) => [x.name, x.taxNumber, x.months, x.salary, x.commission, x.gross, x.paye, r2(x.uif + x.uifEmployer)]),
        foot: people.length ? ['Total', '', '', total((x) => x.salary), total((x) => x.commission), total((x) => x.gross), total((x) => x.paye), total((x) => x.uif + x.uifEmployer)] : null,
        empty: 'No payslips saved in this tax year.',
      },
      {
        heading: 'Month by month (EMP201s, for the EMP501 reconciliation)',
        columns: [{ label: 'Paid in' }, { label: 'Payslips' }, { label: 'Gross', num: true }, { label: 'PAYE', num: true }, { label: 'UIF (staff)', num: true },
          { label: 'UIF (employer)', num: true }, { label: 'Total to SARS', num: true }],
        rows: months.map(([m, slips]) => {
          const paye = sum(slips, (p) => p.paye)
          const uif = sum(slips, (p) => p.uif)
          const er = sum(slips, employerUif)
          return [monthLabel(m), slips.length, sum(slips, (p) => p.gross), paye, uif, er, r2(paye + uif + er)]
        }),
        foot: months.length ? ['Total', inYear.length, sum(inYear, (p) => p.gross), sum(inYear, (p) => p.paye), sum(inYear, (p) => p.uif), sum(inYear, employerUif),
          r2(sum(inYear, (p) => p.paye) + sum(inYear, (p) => p.uif) + sum(inYear, employerUif))] : null,
      },
    ],
    notes: [
      'IRP5 source codes: 3601 salary and other taxable pay, 3606 commission, 4102 PAYE, 4141 UIF (staff and employer together).',
      'Only saved payslips are counted, by pay date. Please check the figures with your accountant before filing on e@syFile.',
    ],
    fileName: `Tax year ${taxYearLabel(year).replace('/', '-')}`,
  }
}

/** All sections as one CSV table (for Excel / Google Sheets). */
export function reportRows(report) {
  const rows = [[report.title], [report.subtitle], []]
  for (const s of report.sections) {
    rows.push([s.heading])
    if (s.note) rows.push([s.note])
    rows.push(s.columns.map((c) => c.label))
    for (const r of s.rows) rows.push(r)
    if (s.foot) rows.push(s.foot)
    rows.push([])
  }
  for (const n of report.notes || []) rows.push([n])
  return rows
}
