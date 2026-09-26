/**
 * Reads the salon's old Google Sheets payslips (one tab per person, labels in column B/E and
 * values in C/F) so their details can fill in the employees' payslip settings.
 */
import { monthRange } from './format.js'
import { birthDateFromId } from './payroll.js'

const txt = (v) => String(v ?? '').trim()
const label = (v) => txt(v).replace(/:$/, '').toLowerCase()
/** "R7,000.00" → 7000 */
export const money = (v) => {
  const n = parseFloat(txt(v).replace(/[R\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}
/** A date cell's serial number → 'YYYY-MM-DD' */
const serial = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10)
/** "9/1/2017" (typed as day/month/year) or a real date cell → '2017-01-09' */
export function dmy(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serial(v) : ''
  const m = txt(v).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
  if (!m) return ''
  const [, d, mo, y] = m
  if (Number(mo) > 12 || Number(d) > 31) return ''
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** "Sep-26" → '2026-09' */
function monthOf(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serial(v).slice(0, 7) : ''
  const m = txt(v).toLowerCase().match(/^([a-z]{3})[a-z]*[\s-]+(\d{2}|\d{4})$/)
  if (!m || !MONTHS.includes(m[1])) return ''
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${y}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`
}
/** "12.42 day(s)" → 12.42 (hours are turned into days with `perDay`) */
function days(v, perDay = 8) {
  const s = txt(v).toLowerCase()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  return /hour/.test(s) ? n / perDay : n
}
/** Sheets drops a leading 0 from numbers: put it back when that makes a valid ID / tax number. */
function fixId(v) {
  const d = txt(v).replace(/\D/g, '')
  if (d.length === 12 && birthDateFromId('0' + d)) return '0' + d
  return d || txt(v)
}
function fixTax(v) {
  const d = txt(v).replace(/\D/g, '')
  return d.length === 9 ? '0' + d : d || txt(v)
}

/**
 * One tab → { name, code, month, payDate, pay, company, earnings, deductions, leave }.
 * `rows` are the tab's values from column A (row 1) on, as shown in the sheet.
 */
export function parsePayslipTab(title, rows) {
  const cell = (r, c) => txt(rows[r]?.[c])
  const out = { tab: title, pay: {}, company: {}, earnings: [], deductions: [], leave: {} }
  const emp = { 'employee name': 'fullName', 'employee code': 'code', 'id number': 'idNumber', 'date engaged': 'engaged',
    'tax number': 'taxNumber', 'bank name': 'bankName', 'account type': 'accountType', 'account number': 'accountNumber', 'branch code': 'branchCode' }
  const co = { 'company name': 'name', 'company type': 'type', 'registration number': 'registration' }
  let section = ''
  for (let r = 0; r < rows.length; r++) {
    const b = label(rows[r]?.[1])
    const e = label(rows[r]?.[4])
    if (b === 'payslip') out.month = monthOf(rows[r + 2]?.[1]) || out.month
    const pd = (rows[r] || []).findIndex((v) => /pay date/i.test(txt(v)))
    if (pd >= 0) out.payDate = dmy(txt(rows[r][pd]).replace(/pay date:?/i, '').trim()) || dmy(rows[r][pd + 1])
    if (b === 'earnings') { section = 'money'; continue }
    if (section === 'money') {
      if (/^total|^nett/.test(b)) {
        if (b.startsWith('total earnings')) out.gross = money(cell(r, 2))
        if (b.startsWith('nett')) out.net = money(cell(r, 2))
      } else if (b && money(cell(r, 2)) != null) out.earnings.push({ label: txt(rows[r][1]), amount: money(cell(r, 2)) })
      if (e && money(cell(r, 5)) != null) out.deductions.push({ label: txt(rows[r][4]), amount: money(cell(r, 5)) })
      continue
    }
    if (emp[b]) out.pay[emp[b]] = emp[b] === 'engaged' ? rows[r][2] : cell(r, 2)
    if (co[e]) out.company[co[e]] = cell(r, 5)
    // Address: the label row and the rows under it (until the next label).
    const lines = (c) => {
      const got = []
      for (let i = r; i < rows.length && i < r + 8; i++) {
        if (i > r && label(rows[i]?.[c - 1])) break
        if (cell(i, c)) got.push(cell(i, c))
        else if (i > r) break
      }
      return got.join('\n')
    }
    if (b === 'address') out.pay.address = lines(2)
    if (e === 'address') out.company.address = lines(5)
    if (e === 'leave accrued') out.leave.accrued = cell(r, 5)
    if (e === 'leave taken') out.leave.taken = cell(r, 5)
    if (e === 'total leave') out.leave.total = cell(r, 5)
    if (e === 'leave available') out.leave.available = cell(r, 5)
  }
  const p = out.pay
  if (p.idNumber) p.idNumber = fixId(p.idNumber)
  if (p.taxNumber) p.taxNumber = fixTax(p.taxNumber)
  if (p.engaged !== undefined) p.engaged = dmy(p.engaged)
  if (p.accountNumber) p.accountNumber = p.accountNumber.replace(/\s/g, '')
  if (p.branchCode) p.branchCode = p.branchCode.replace(/\s/g, '')
  const first = out.earnings[0]
  if (first && !/commis/i.test(first.label)) {
    p.salaryLabel = first.label
    p.basic = first.amount
  }
  out.commission = out.earnings.filter((x) => /commis/i.test(x.label)).reduce((s, x) => s + x.amount, 0)
  out.name = p.fullName || title.replace(/payslip/i, '').trim()
  return out
}

/** A round-ish percentage (e.g. 0.2 → 20), or null. */
function roundPct(rate) {
  const pct = rate * 100
  return Math.abs(pct - Math.round(pct * 2) / 2) < 0.05 && pct > 0 && pct <= 100 ? Math.round(pct * 2) / 2 : null
}

/**
 * What an old payslip would fill in for an employee (only fields that are still empty).
 * `takings` = her appointments' total for that payslip's month, used to work out the commission %.
 */
export function suggestFor(slip, emp, { takings = null, startDay = 1 } = {}) {
  const cur = emp.pay || {}
  const set = {}
  const empty = (k) => cur[k] === '' || cur[k] == null
  for (const k of ['fullName', 'code', 'idNumber', 'address', 'engaged', 'taxNumber', 'bankName', 'accountType', 'accountNumber', 'branchCode', 'basic']) {
    if (empty(k) && slip.pay[k] !== '' && slip.pay[k] != null) set[k] = slip.pay[k]
  }
  if (slip.pay.salaryLabel && (empty('salaryLabel') || cur.salaryLabel === 'Basic Salary') && slip.pay.salaryLabel !== cur.salaryLabel) set.salaryLabel = slip.pay.salaryLabel
  // Commission %: try "above her basic" first (the salon's usual way), then "on all takings".
  const notes = []
  if (slip.commission && takings && empty('commissionPct')) {
    const basic = Number(cur.basic || slip.pay.basic) || 0
    const above = basic && takings > basic ? roundPct(slip.commission / (takings - basic)) : null
    const all = roundPct(slip.commission / takings)
    if (above) Object.assign(set, { commissionPct: above, commissionOn: 'aboveBasic' })
    else if (all) Object.assign(set, { commissionPct: all, commissionOn: 'all' })
    else notes.push('Commission % could not be worked out from this payslip — set it by hand.')
  }
  // Leave: "Total Leave" was her balance at the end of that payslip's month.
  const perDay = Number(cur.hoursPerDay) || 8
  const total = days(slip.leave.total, perDay)
  if (total != null && empty('leaveOpening') && slip.month) {
    set.leaveOpening = Math.round(total * 100) / 100
    set.leaveFrom = monthRange(slip.month, startDay).to
  }
  const accrued = days(slip.leave.accrued, perDay)
  if (accrued != null && empty('leavePerYear')) set.leavePerYear = Math.round(accrued * 12 * perDay * 100) / 100
  // No leave figures on her payslip (just an empty "Leave Available"): she's the owner.
  const owner = !cur.owner && 'available' in slip.leave && !slip.leave.available && total == null
  if (owner) set.owner = true
  return { set, notes }
}

/** Matches a tab to an employee by first name (tab title or the name on the payslip). */
export function matchEmployee(slip, employees) {
  const first = (s) => txt(s).split(/\s+/)[0].toLowerCase()
  const names = [first(slip.tab), first(slip.pay.fullName)]
  return employees.find((e) => names.includes(first(e.name)))
}
