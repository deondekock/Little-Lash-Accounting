/**
 * Payroll maths: commission (with overtime), PAYE, UIF and annual leave.
 *
 * PAYE follows SARS's annualised method for a monthly-paid employee: this month's
 * taxable pay × 12, tax from the year's table, minus the rebates for her age, ÷ 12.
 * UIF is 1% (employee) + 1% (employer) of pay excluding commission, up to the
 * monthly ceiling.
 */
import { monthRange } from './format.js'

/**
 * SARS tables per tax year (the year ending in February). Brackets are
 * [upper limit of taxable income, rate]; base amounts are worked out below.
 * Add a new year here after each February budget.
 */
const TABLES = {
  2026: { // 1 Mar 2025 – 28 Feb 2026
    brackets: [[237100, 0.18], [370500, 0.26], [512800, 0.31], [673000, 0.36], [857900, 0.39], [1817000, 0.41], [Infinity, 0.45]],
    rebates: { primary: 17235, secondary: 9444, tertiary: 3145 },
  },
  2027: { // 1 Mar 2026 – 28 Feb 2027
    brackets: [[245100, 0.18], [383100, 0.26], [530200, 0.31], [695800, 0.36], [887000, 0.39], [1878600, 0.41], [Infinity, 0.45]],
    rebates: { primary: 17820, secondary: 9765, tertiary: 3249 },
  },
}
export const UIF_RATE = 0.01
export const UIF_CEILING = 17712 // monthly remuneration cap → max R177.12 each

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Tax year (year ending February) for a 'YYYY-MM-DD' date. */
export function taxYear(date) {
  const [y, m] = date.split('-').map(Number)
  return m >= 3 ? y + 1 : y
}

/** The table for that tax year, or the latest one we have (with a note). */
export function tableFor(date) {
  const year = taxYear(date)
  if (TABLES[year]) return { year, ...TABLES[year], exact: true }
  const years = Object.keys(TABLES).map(Number).sort((a, b) => a - b)
  const use = year < years[0] ? years[0] : years[years.length - 1]
  return { year: use, ...TABLES[use], exact: false, wanted: year }
}

/** "2027/28" for the tax year ending February 2028. */
export const taxYearLabel = (year) => `${year - 1}/${String(year).slice(2)}`

/**
 * Reminder that the tax tables need updating (they're in this file, so Deon has to do it):
 * 'due' once the new tax year has started without its table, 'soon' from mid-February.
 */
export function taxTableNotice(today) {
  const year = taxYear(today)
  if (!TABLES[year]) return { level: 'due', year }
  if (today.slice(5) >= '02-15' && today.slice(5, 7) === '02' && !TABLES[year + 1]) return { level: 'soon', year: year + 1 }
  return null
}

/** Tax on a year's taxable income before rebates. */
export function annualTax(income, brackets) {
  let tax = 0
  let lower = 0
  for (const [upper, rate] of brackets) {
    if (income <= lower) break
    tax += (Math.min(income, upper) - lower) * rate
    lower = upper
  }
  return tax
}

/** Date of birth ('YYYY-MM-DD') from a South African ID number, or ''. */
export function birthDateFromId(id, onDate) {
  const digits = String(id || '').replace(/\D/g, '')
  if (digits.length !== 13) return ''
  const yy = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const dd = Number(digits.slice(4, 6))
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return ''
  const nowYY = Number((onDate || new Date().toISOString()).slice(2, 4))
  const year = yy > nowYY ? 1900 + yy : 2000 + yy
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Age on a date. */
export function ageOn(birth, date) {
  if (!birth) return null
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

/** Monthly PAYE on this month's taxable pay. `age` = age at the end of the tax year (null = under 65). */
export function monthlyPaye(monthlyTaxable, payDate, age = null) {
  const t = tableFor(payDate)
  const yearly = annualTax(Math.max(0, monthlyTaxable) * 12, t.brackets)
  let rebate = t.rebates.primary
  if (age >= 65) rebate += t.rebates.secondary
  if (age >= 75) rebate += t.rebates.tertiary
  return { paye: round2(Math.max(0, yearly - rebate) / 12), table: t }
}

/** Employee UIF (the employer pays the same again). */
export const monthlyUif = (uifPay) => round2(Math.min(Math.max(0, uifPay), UIF_CEILING) * UIF_RATE)

/** Age used for rebates: on the last day of the tax year. */
export function rebateAge(idNumber, payDate) {
  const birth = birthDateFromId(idNumber, payDate)
  if (!birth) return null
  const end = `${taxYear(payDate)}-02-28`
  return ageOn(birth, end)
}

/* ---------------- overtime ---------------- */

export const OVERTIME_CHOICES = [
  { value: 0, label: 'No' },
  { value: 30, label: '½ h' },
  { value: 60, label: '1 h' },
  { value: 90, label: '1½ h' },
  { value: 120, label: '2 h' },
  { value: 'all', label: 'All of it' },
]

export const LENGTH_CHOICES = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300]

export function minutesLabel(min) {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} min`
  if (m === 30) return `${h}½ h`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Share (0–1) of an appointment that fell in overtime. */
export function overtimeShare(a) {
  if (!a.overtime) return 0
  if (a.overtime === 'all') return 1
  if (!a.length) return 1 // time not known: count it all
  return Math.min(1, a.overtime / a.length)
}

/** Label for an appointment's overtime, e.g. "Overtime 1 h of 2 h". */
export function overtimeLabel(a) {
  if (!a.overtime) return ''
  if (a.overtime === 'all' || overtimeShare(a) === 1) return 'Overtime'
  return `Overtime ${minutesLabel(a.overtime)} of ${minutesLabel(a.length)}`
}

/* ---------------- commission ---------------- */

/**
 * Commission for one employee over a set of appointments.
 * Overtime takings (the overtime share of each appointment) earn the overtime rate;
 * the rest earns the normal rate, on takings above the threshold (if any).
 */
export function commission(appts, pay, { onlyPaid = false } = {}) {
  const list = onlyPaid ? appts.filter((a) => a.status === 'Paid') : appts
  let normal = 0
  let overtime = 0
  let unpaid = 0
  let otCount = 0
  for (const a of appts) if (a.status !== 'Paid') unpaid += a.amount
  for (const a of list) {
    const share = overtimeShare(a)
    overtime += a.amount * share
    normal += a.amount * (1 - share)
    if (share) otCount++
  }
  const threshold = pay.commissionOn === 'aboveBasic' ? Number(pay.basic) || 0 : pay.commissionOn === 'above' ? Number(pay.threshold) || 0 : 0
  const rate = (Number(pay.commissionPct) || 0) / 100
  const otRate = pay.overtimePct === '' || pay.overtimePct == null ? rate : (Number(pay.overtimePct) || 0) / 100
  return {
    count: list.length,
    takings: round2(normal + overtime),
    normal: round2(normal),
    overtime: round2(overtime),
    otCount,
    unpaid: round2(unpaid),
    threshold,
    rate,
    otRate,
    normalCommission: round2(Math.max(0, normal - threshold) * rate),
    overtimeCommission: round2(overtime * otRate),
  }
}

/* ---------------- leave ---------------- */

/** Whole months from `from` to `to` (a month counts once its day-of-month is reached). */
export function monthsBetween(from, to) {
  if (!from || !to || to < from) return 0
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0)
}

/** Days of the week she works (0 = Sunday): 5 → Mon–Fri, 6 → Mon–Sat, 7 → every day. */
export function weekDays(perWeek = 5) {
  const n = Math.min(7, Math.max(1, Math.round(Number(perWeek) || 5)))
  return [1, 2, 3, 4, 5, 6, 0].slice(0, n)
}

/** Her work days between two dates, inclusive. */
export function workDays(from, to, days = weekDays(5)) {
  if (!from || !to || to < from) return 0
  let n = 0
  const d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end) {
    if (days.includes(d.getDay())) n++
    d.setDate(d.getDate() + 1)
  }
  return n
}

/** 'YYYY-MM-DD' + n months (the day is kept, or the month's last day). */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
const dayBefore = (date) => {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Her working week and leave settings, with the legal minimums (Basic Conditions of Employment Act):
 * annual leave 3 weeks a year; sick leave 6 weeks per 3-year cycle; family responsibility 3 days a year.
 */
export function leaveSettings(pay = {}) {
  const owner = !!pay.owner
  const perDay = Number(pay.hoursPerDay) || 8
  const perWeek = Math.min(7, Math.max(1, Number(pay.daysPerWeek) || 5))
  const weekHours = perDay * perWeek
  // The owner isn't bound by the legal minimums: her leave is whatever she sets (none by default).
  const minYear = owner ? 0 : 3 * weekHours
  const perYear = pay.leavePerYear === '' || pay.leavePerYear == null ? minYear : Number(pay.leavePerYear) || 0
  return {
    owner,
    perDay,
    perWeek,
    minYear,
    perYear,
    perMonth: round2(perYear / 12 / perDay), // days of annual leave earned each month
    sickCycle: 6 * weekHours,
    family: 3 * perDay,
  }
}

/**
 * Annual leave for an employee on a date: opening balance (at `leaveFrom`; with no balance, from the
 * date engaged) + leave earned each month since (hours per year ÷ 12) − annual leave taken since.
 * Returns days and hours.
 */
export function leaveBalance(emp, leave, onDate) {
  const pay = emp.pay || {}
  const { perDay, perMonth, perYear } = leaveSettings(pay)
  const start = pay.leaveFrom || pay.engaged || ''
  const opening = Number(pay.leaveOpening) || 0
  const months = start ? monthsBetween(start, onDate) : 0
  const accrued = (months * perYear) / 12 / perDay
  const mine = leave.filter((l) => l.employeeId === emp.id && l.type === 'Annual' && (!start || l.from >= start))
  const takenHours = mine.filter((l) => l.from <= onDate).reduce((s, l) => s + l.hours, 0)
  const bookedHours = mine.filter((l) => l.from > onDate).reduce((s, l) => s + l.hours, 0)
  const days = opening + accrued - takenHours / perDay
  return {
    start,
    perDay,
    perMonth,
    perYear,
    opening,
    accrued: round2(accrued),
    takenDays: round2(takenHours / perDay),
    takenHours: round2(takenHours),
    bookedDays: round2(bookedHours / perDay),
    bookedHours: round2(bookedHours),
    days: round2(days),
    hours: round2(days * perDay),
    afterBooked: round2(days - bookedHours / perDay),
  }
}

/** The owner has no set sick or family leave: just what she took in the last 12 months. */
function ownerTaken(emp, leave, onDate, type, set) {
  const from = addMonths(onDate, -12)
  const taken = hoursOf(leave, emp.id, type, from, onDate)
  return { owner: true, from, to: onDate, eligible: true, entitled: null, taken: round2(taken), booked: 0, hours: null, perDay: set.perDay }
}

/** The cycle (from the date engaged, every `months`) that `onDate` falls in. */
function cycleOf(engaged, onDate, months) {
  const i = Math.floor(monthsBetween(engaged, onDate) / months)
  const from = addMonths(engaged, i * months)
  return { from, to: dayBefore(addMonths(engaged, (i + 1) * months)) }
}

const hoursOf = (leave, empId, type, from, to) =>
  leave.filter((l) => l.employeeId === empId && l.type === type && l.from >= from && l.from <= to).reduce((s, l) => s + l.hours, 0)

/**
 * Sick leave (BCEA s22): 6 weeks of her normal working time per 3-year cycle from the date engaged.
 * In the first 6 months: 1 day for every 26 days worked (and that counts towards the cycle).
 * `sickUsed` = hours already taken in the current cycle before the app (dated `leaveFrom`).
 */
export function sickBalance(emp, leave, onDate) {
  const pay = emp.pay || {}
  if (pay.owner) return ownerTaken(emp, leave, onDate, 'Sick', leaveSettings(pay))
  if (!pay.engaged || onDate < pay.engaged) return null
  const set = leaveSettings(pay)
  const cycle = cycleOf(pay.engaged, onDate, 36)
  const firstSix = monthsBetween(pay.engaged, onDate) < 6
  const entitled = firstSix
    ? Math.floor(workDays(pay.engaged, onDate, weekDays(set.perWeek)) / 26) * set.perDay
    : set.sickCycle
  const before = Number(pay.sickUsed) || 0
  const usedBefore = before && (!pay.leaveFrom || (pay.leaveFrom >= cycle.from && pay.leaveFrom <= cycle.to)) ? before : 0
  const taken = usedBefore + hoursOf(leave, emp.id, 'Sick', cycle.from, onDate)
  const booked = leave.filter((l) => l.employeeId === emp.id && l.type === 'Sick' && l.from > onDate && l.from <= cycle.to).reduce((s, l) => s + l.hours, 0)
  return { ...cycle, firstSix, entitled, taken: round2(taken), booked: round2(booked), hours: round2(entitled - taken), perDay: set.perDay }
}

/**
 * Family responsibility leave (BCEA s27): 3 days per 12-month cycle from the date engaged, once she has
 * worked there longer than 4 months and works at least 4 days a week. Unused days don't carry over.
 */
export function familyBalance(emp, leave, onDate) {
  const pay = emp.pay || {}
  if (pay.owner) return ownerTaken(emp, leave, onDate, 'Family', leaveSettings(pay))
  if (!pay.engaged || onDate < pay.engaged) return null
  const set = leaveSettings(pay)
  const cycle = cycleOf(pay.engaged, onDate, 12)
  const eligible = monthsBetween(pay.engaged, onDate) >= 4 && set.perWeek >= 4
  const taken = hoursOf(leave, emp.id, 'Family', cycle.from, cycle.to)
  const entitled = eligible ? set.family : 0
  return { ...cycle, eligible, entitled, taken: round2(taken), hours: round2(entitled - taken), perDay: set.perDay }
}

/** Leave taken in a business month (for the payslip). */
export function leaveInMonth(empId, leave, month, startDay) {
  const r = monthRange(month, startDay)
  return leave.filter((l) => l.employeeId === empId && l.from >= r.from && l.from <= r.to)
}

export const LEAVE_TYPES = ['Annual', 'Sick', 'Family', 'Maternity', 'Unpaid']
/** Maternity leave (BCEA s25): 4 consecutive months, not paid by the employer (she claims from UIF). */
export const MATERNITY_MONTHS = 4

/** "12.5 days (100 h)" */
export function leaveText(days, perDay = 8) {
  const d = Math.round(days * 100) / 100
  const h = Math.round(days * perDay * 10) / 10
  return `${d} day${Math.abs(d) === 1 ? '' : 's'} (${h} h)`
}

/* ---------------- a whole payslip ---------------- */

/** Default pay settings for an employee without any yet. */
export function payDefaults(p = {}) {
  return {
    fullName: '', code: '', idNumber: '', address: '', engaged: '', taxNumber: '',
    bankName: '', accountType: '', accountNumber: '', branchCode: '',
    salaryLabel: 'Basic Salary', basic: '', commissionPct: '', commissionOn: 'all', threshold: '', overtimePct: '',
    leavePerYear: '', hoursPerDay: 8, daysPerWeek: 5, leaveOpening: '', leaveFrom: '', sickUsed: '', owner: false,
    ...p,
  }
}

/**
 * Works out a draft payslip for an employee and business month.
 * `over` = amounts she typed over the calculated ones ({ commission, overtime, paye, uif }).
 */
export function draftPayslip({ emp, appts, leave, month, startDay, payDate, onlyPaid = false, extras = [], deductions = [], over = {} }) {
  const pay = payDefaults(emp.pay)
  const period = monthRange(month, startDay)
  const mine = appts.filter((a) => a.employeeId === emp.id && a.month === month)
  const c = commission(mine, pay, { onlyPaid })
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const basic = Number(pay.basic) || 0
  const comm = num(over.commission) ?? c.normalCommission
  const ot = num(over.overtime) ?? c.overtimeCommission
  const extraTotal = extras.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const gross = round2(basic + comm + ot + extraTotal)
  const age = rebateAge(pay.idNumber, payDate)
  const calcPaye = monthlyPaye(gross, payDate, age)
  const paye = num(over.paye) ?? calcPaye.paye
  // UIF: on pay excluding commission (basic + other earnings), capped.
  const uifPay = basic + extras.filter((x) => !x.noUif).reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const uif = num(over.uif) ?? monthlyUif(uifPay)
  const otherDed = deductions.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const totalDed = round2(paye + uif + otherDed)
  const lb = leaveBalance({ ...emp, pay }, leave, period.to)
  const taken = leaveInMonth(emp.id, leave, month, startDay)
  return {
    employeeId: emp.id,
    name: pay.fullName || emp.name,
    month,
    period,
    payDate,
    pay,
    appts: c,
    earnings: [
      { label: pay.salaryLabel || 'Basic Salary', amount: basic },
      { label: 'Commission', amount: comm, calc: c.normalCommission },
      { label: 'Overtime Commission', amount: ot, calc: c.overtimeCommission },
      ...extras.map((x) => ({ label: x.label || 'Other', amount: Number(x.amount) || 0 })),
    ].filter((x, i) => i === 0 || x.amount),
    deductions: [
      { label: 'PAYE', amount: paye, calc: calcPaye.paye },
      { label: 'UIF', amount: uif },
      ...deductions.map((x) => ({ label: x.label || 'Other', amount: Number(x.amount) || 0 })),
    ],
    gross,
    totalDeductions: totalDed,
    net: round2(gross - totalDed),
    employerUif: monthlyUif(uifPay),
    age,
    table: calcPaye.table,
    leave: {
      ...lb,
      accruedThisMonth: lb.perMonth,
      takenThisMonth: taken.filter((l) => l.type === 'Annual').reduce((s, l) => s + l.hours, 0),
      taken,
      sick: sickBalance({ ...emp, pay }, leave, period.to),
      family: familyBalance({ ...emp, pay }, leave, period.to),
    },
  }
}
