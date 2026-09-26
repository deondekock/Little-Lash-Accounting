/**
 * Data layer: the Google Sheet is the database.
 *
 * Tabs (same layout the old Apps Script version created, so existing sheets keep working):
 *   Employees    ID | Name | Phone | Active | Created At | Updated At | payslip details
 *                (Full Name, Employee Code, ID Number, Address, … Basic Salary, Commission %, leave — see PAY_FIELDS)
 *   Appointments ID | Date | Month | Employee ID | Employee | Client | Service |
 *                Amount | Method | Status | Paid On | Notes | Created At | Updated At |
 *                Overtime (minutes done after hours, or "All") | Length (minutes the appointment took)
 *   Leave        ID | Employee ID | Employee | Type | From | To | Hours | Notes | Created At | Updated At
 *   Payslips     ID | Employee ID | Employee | Month | Pay Date | Gross | PAYE | UIF | Deductions | Net |
 *                Details (the whole payslip as JSON) | Created At | Updated At
 *   Settings     Setting | Value      ("Month starts on day" → 26 = months run 26th–25th; company details for payslips)
 *   Services     ID | Name | Price | Active | Created At | Updated At | Team Prices
 *                (Price = for anyone; Team Prices = JSON { employeeId: price } when someone charges differently)
 *   History      ID | Time | Who | Action | Summary | Undone At | Data 1…10
 *                Every change the app makes is logged here with the rows as they were
 *                *before* the change, so any change (or a whole day) can be rolled back.
 *
 * The whole sheet is loaded once (one request) and kept in memory, so switching
 * months/employees is instant. Writes go straight to the sheet. Before changing
 * an existing row we check the row still holds the same ID (the sheet may have
 * been edited elsewhere) and re-locate it if not.
 */
import { sheetsApi, range, enc, parseSheetId } from './google/sheets.js'
import { businessMonth, todayStr, fmt0 } from './lib/format.js'
import { splitServices, joinServices, serviceKey } from './lib/services.js'
import { parsePayslipTab } from './lib/payslipImport.js'

export const METHODS = ['Cash', 'Card', 'EFT']
const TITLE = 'Little Lash Lounge Payments'
const EMPLOYEES = 'Employees'
const APPOINTMENTS = 'Appointments'
const SETTINGS = 'Settings'
const HISTORY = 'History'
const SERVICES = 'Services'
const LEAVE = 'Leave'
const PAYSLIPS = 'Payslips'
const SERVICE_HEADERS = ['ID', 'Name', 'Price', 'Active', 'Created At', 'Updated At', 'Team Prices']
const MONTH_START_SETTING = 'Month starts on day'

/** Payslip details kept per employee (Employees tab, after Updated At). */
const PAY_FIELDS = [
  ['fullName', 'Full Name'], ['code', 'Employee Code'], ['idNumber', 'ID Number'], ['address', 'Address'],
  ['engaged', 'Date Engaged', 'date'], ['taxNumber', 'Tax Number'], ['bankName', 'Bank Name'],
  ['accountType', 'Account Type'], ['accountNumber', 'Account Number'], ['branchCode', 'Branch Code'],
  ['salaryLabel', 'Salary Label'], ['basic', 'Basic Salary', 'num'], ['commissionPct', 'Commission %', 'num'],
  ['commissionOn', 'Commission On'], ['threshold', 'Commission Above', 'num'], ['overtimePct', 'Overtime Commission %', 'num'],
  ['leavePerYear', 'Annual Leave Hours / Year', 'num'], ['hoursPerDay', 'Hours / Day', 'num'],
  ['leaveOpening', 'Leave Balance (days)', 'num'], ['leaveFrom', 'Leave Balance On', 'date'],
  ['daysPerWeek', 'Days / Week', 'num'], ['sickUsed', 'Sick Hours Used Before', 'num'], ['owner', 'Owner', 'bool'],
]
/** Older sheets kept annual leave as days per month in this column (converted to hours per year on load). */
const OLD_LEAVE_HEADER = 'Leave Days / Month'
const EMPLOYEE_HEADERS = ['ID', 'Name', 'Phone', 'Active', 'Created At', 'Updated At', ...PAY_FIELDS.map((f) => f[1])]
const APPOINTMENT_HEADERS = [
  'ID', 'Date', 'Month', 'Employee ID', 'Employee', 'Client', 'Service',
  'Amount', 'Method', 'Status', 'Paid On', 'Notes', 'Created At', 'Updated At', 'Overtime', 'Length (min)',
]
const LEAVE_HEADERS = ['ID', 'Employee ID', 'Employee', 'Type', 'From', 'To', 'Hours', 'Notes', 'Created At', 'Updated At']
const PAYSLIP_HEADERS = ['ID', 'Employee ID', 'Employee', 'Month', 'Pay Date', 'Gross', 'PAYE', 'UIF', 'Deductions', 'Net', 'Details', 'Created At', 'Updated At']
export const LEAVE_TYPES = ['Annual', 'Sick', 'Family', 'Maternity', 'Unpaid']
/** Company details for payslips (rows in the Settings tab). */
const COMPANY_FIELDS = [
  ['name', 'Company Name'], ['type', 'Company Type'], ['registration', 'Registration Number'],
  ['address', 'Company Address'], ['payeRef', 'PAYE Reference'], ['uifRef', 'UIF Reference'],
]
const HISTORY_HEADERS = ['ID', 'Time', 'Who', 'Action', 'Summary', 'Undone At',
  ...Array.from({ length: 10 }, (_, i) => `Data ${i + 1}`)]
const HEADERS = {
  [EMPLOYEES]: EMPLOYEE_HEADERS, [APPOINTMENTS]: APPOINTMENT_HEADERS, [SETTINGS]: ['Setting', 'Value'], [HISTORY]: HISTORY_HEADERS,
  [SERVICES]: SERVICE_HEADERS, [LEAVE]: LEAVE_HEADERS, [PAYSLIPS]: PAYSLIP_HEADERS,
}
const colLetter = (n) => (n > 26 ? colLetter(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26))
const LAST_COL = Object.fromEntries(Object.entries(HEADERS).map(([t, h]) => [t, colLetter(h.length)]))
const TABS = [EMPLOYEES, APPOINTMENTS, SERVICES, LEAVE, PAYSLIPS, SETTINGS, HISTORY]
/** History keys → tab (the rows each change touched, by kind). */
const KIND_TAB = { appts: APPOINTMENTS, emps: EMPLOYEES, svcs: SERVICES, leave: LEAVE, pays: PAYSLIPS }
const CHUNK = 45000 // a cell holds up to 50,000 characters

// Zero-based column indexes.
const A = {
  ID: 0, DATE: 1, MONTH: 2, EMPLOYEE_ID: 3, EMPLOYEE: 4, CLIENT: 5, SERVICE: 6,
  AMOUNT: 7, METHOD: 8, STATUS: 9, PAID_ON: 10, NOTES: 11, CREATED: 12, UPDATED: 13, OVERTIME: 14, LENGTH: 15,
}
const E = { ID: 0, NAME: 1, PHONE: 2, ACTIVE: 3, CREATED: 4, UPDATED: 5 }
const S = { ID: 0, NAME: 1, PRICE: 2, ACTIVE: 3, CREATED: 4, UPDATED: 5, PRICES: 6 }

const db = {
  id: '',
  url: '',
  gids: {}, // tab title → numeric sheetId (needed to delete rows)
  startDay: 1,
  employees: [], // { id, name, phone, active, row, raw }
  services: [], // { id, name, price, active, row, raw }
  appts: [], // { ...appointment, row, raw }
  leave: [], // { id, employeeId, type, from, to, hours, notes, row, raw }
  payslips: [], // { id, employeeId, month, payDate, net, details, row, raw }
  company: {},
}

/* ---------------- helpers ---------------- */

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim())
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2))

/** Text cells come back as strings; cells Sheets turned into dates come back as serial numbers. */
function dateText(v) {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5)
    return d.toISOString().slice(0, 10)
  }
  return clean(v)
}

function rowToEmployee(r, row) {
  const active = r[E.ACTIVE]
  const pay = {}
  PAY_FIELDS.forEach(([key, , kind], i) => {
    const v = r[6 + i]
    pay[key] = kind === 'date' ? dateText(v) : kind === 'num' ? (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v))
      : kind === 'bool' ? v === true || /^(yes|true|1)$/i.test(clean(v)) : clean(v)
  })
  // A leave balance saved without its date: it was her balance when it was saved.
  if ((pay.leaveOpening !== '' || pay.sickUsed !== '') && !pay.leaveFrom) pay.leaveFrom = dateText(r[E.UPDATED]).slice(0, 10)
  return {
    id: clean(r[E.ID]),
    name: clean(r[E.NAME]),
    phone: clean(r[E.PHONE]),
    active: active === true || String(active).toUpperCase() === 'TRUE',
    pay,
    row,
    raw: r,
  }
}

/** Payslip details from the form → cells (numbers as numbers, blanks stay blank). */
function payCells(pay = {}) {
  // A leave balance without a date is her balance today.
  const given = (v) => v !== '' && v != null
  if ((given(pay.leaveOpening) || given(pay.sickUsed)) && !pay.leaveFrom) pay = { ...pay, leaveFrom: todayStr() }
  return PAY_FIELDS.map(([key, label, kind]) => {
    const v = pay[key]
    if (kind === 'num') {
      if (v === '' || v == null) return ''
      const n = parseFloat(String(v).replace(',', '.'))
      if (!Number.isFinite(n) || n < 0) throw new Error(`Please check "${label}".`)
      return n
    }
    if (kind === 'bool') return v ? 'Yes' : ''
    if (kind === 'date') {
      const d = clean(v)
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Please check "${label}".`)
      return d
    }
    return String(v ?? '').replace(/\r/g, '').trim()
  })
}

function rowToAppointment(r, row) {
  const date = dateText(r[A.DATE])
  return {
    id: clean(r[A.ID]),
    date,
    month: dateText(r[A.MONTH]).slice(0, 7) || date.slice(0, 7),
    employeeId: clean(r[A.EMPLOYEE_ID]),
    employeeName: clean(r[A.EMPLOYEE]),
    client: clean(r[A.CLIENT]),
    service: clean(r[A.SERVICE]),
    amount: Number(r[A.AMOUNT]) || 0,
    method: clean(r[A.METHOD]),
    status: clean(r[A.STATUS]) === 'Paid' ? 'Paid' : 'Unpaid',
    paidOn: dateText(r[A.PAID_ON]),
    notes: clean(r[A.NOTES]),
    overtime: overtimeValue(r[A.OVERTIME]),
    length: Number(r[A.LENGTH]) > 0 ? Number(r[A.LENGTH]) : 0,
    row,
    raw: r,
  }
}

/** Overtime cell → 0 (none), minutes, or 'all'. */
function overtimeValue(v) {
  if (String(v ?? '').trim().toLowerCase() === 'all') return 'all'
  const n = Number(v)
  return n > 0 ? n : 0
}

function appointmentToRow(a, created, updated) {
  return [a.id, a.date, a.month, a.employeeId, a.employeeName, a.client, a.service,
    a.amount, a.method, a.status, a.paidOn, a.notes, created, updated,
    a.overtime === 'all' ? 'All' : a.overtime || '', a.overtime && a.length ? a.length : '']
}

function rowToLeave(r, row) {
  return {
    id: clean(r[0]), employeeId: clean(r[1]), employeeName: clean(r[2]),
    type: LEAVE_TYPES.includes(clean(r[3])) ? clean(r[3]) : 'Annual',
    from: dateText(r[4]), to: dateText(r[5]) || dateText(r[4]),
    hours: Number(r[6]) || 0, notes: clean(r[7]), row, raw: r,
  }
}

function rowToPayslip(r, row) {
  let details = null
  try { details = JSON.parse(r[10] || 'null') } catch { details = null }
  return {
    id: clean(r[0]), employeeId: clean(r[1]), employeeName: clean(r[2]), month: dateText(r[3]).slice(0, 7),
    payDate: dateText(r[4]), gross: Number(r[5]) || 0, paye: Number(r[6]) || 0, uif: Number(r[7]) || 0,
    deductions: Number(r[8]) || 0, net: Number(r[9]) || 0, details, updatedAt: clean(r[12]), row, raw: r,
  }
}

const strip = ({ row, raw, ...x }) => x
const publicLeave = () => db.leave.map(strip).sort((a, b) => (a.from < b.from ? 1 : -1))
const publicPayslips = () => db.payslips.map(strip)

/** Public copy (no sheet internals), with the employee's current name. */
function publicAppt(a) {
  const { row, raw, ...rest } = a
  return { ...rest, employeeName: db.employees.find((e) => e.id === a.employeeId)?.name || a.employeeName }
}

/** Team Prices cell → { employeeId: price } (ignores anything unreadable). */
function parsePrices(cell) {
  try {
    const obj = JSON.parse(cell || '{}')
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => Number.isFinite(Number(v)) && v !== '').map(([k, v]) => [k, Number(v)]))
  } catch {
    return {}
  }
}

const cleanPrice = (v) => (v === '' || v == null ? '' : Math.round(parseFloat(String(v).replace(',', '.')) * 100) / 100)

/** { employeeId: price } → Team Prices cell ('' when none). */
function pricesCell(prices) {
  const out = {}
  for (const [k, v] of Object.entries(prices || {})) {
    const n = cleanPrice(v)
    if (n !== '' && n >= 0) out[k] = n
  }
  return Object.keys(out).length ? JSON.stringify(out) : ''
}

function rowToService(r, row) {
  const active = r[S.ACTIVE]
  return {
    id: clean(r[S.ID]),
    name: clean(r[S.NAME]),
    price: r[S.PRICE] === '' || r[S.PRICE] == null ? null : Number(r[S.PRICE]) || 0,
    prices: parsePrices(r[S.PRICES]),
    active: !(active === false || String(active).toUpperCase() === 'FALSE'),
    row,
    raw: r,
  }
}

function publicServices() {
  return db.services.map(({ row, raw, ...s }) => s).sort((a, b) => a.name.localeCompare(b.name))
}

const listFor = (tab) => ({ [APPOINTMENTS]: db.appts, [EMPLOYEES]: db.employees, [SERVICES]: db.services, [LEAVE]: db.leave, [PAYSLIPS]: db.payslips })[tab]

function publicEmployees() {
  return db.employees
    .map(({ row, raw, ...e }) => e)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Row number from an A1 range like "'Appointments'!A123:N123". */
const rowOf = (a1) => Number(String(a1).match(/![A-Z]+(\d+)/)[1])

// Writes run one at a time so row numbers never race each other.
let queue = Promise.resolve()
function serial(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

class StaleError extends Error {}

/** Current row numbers for these items; re-locates them if the sheet was edited elsewhere. */
async function locateRows(tab, items) {
  if (items.length && items.length <= 20) {
    const res = await sheetsApi(`/${db.id}/values:batchGet`, { query: { ranges: items.map((x) => range(tab, `A${x.row}`)) } })
    const ok = res.valueRanges.every((vr, i) => clean(vr.values?.[0]?.[0]) === items[i].id)
    if (ok) return
  }
  const res = await sheetsApi(`/${db.id}/values/${enc(range(tab, 'A:A'))}`)
  const index = new Map((res.values || []).map((r, i) => [clean(r[0]), i + 1]))
  for (const x of items) {
    const row = index.get(x.id)
    if (!row) throw new StaleError('This was changed on another device. Your data has been refreshed — please try again.')
    x.row = row
  }
  // Other cached rows may have moved too.
  for (const x of listFor(tab)) x.row = index.get(x.id) || x.row
}

async function guarded(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof StaleError) await load()
    throw err
  }
}

function shiftRowsAfter(list, deletedRow) {
  for (const x of list) if (x.row > deletedRow) x.row--
}

async function deleteRow(tab, row) {
  await sheetsApi(`/${db.id}:batchUpdate`, {
    method: 'POST',
    body: { requests: [{ deleteDimension: { range: { sheetId: db.gids[tab], dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] },
  })
}

async function appendRow(tab, values) {
  const res = await sheetsApi(`/${db.id}/values/${enc(range(tab, `A:${LAST_COL[tab]}`))}:append`, {
    method: 'POST',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    body: { values: [values] },
  })
  return rowOf(res.updates.updatedRange)
}

async function writeRow(tab, row, values) {
  await sheetsApi(`/${db.id}/values/${enc(range(tab, `A${row}:${LAST_COL[tab]}${row}`))}`, {
    method: 'PUT',
    query: { valueInputOption: 'RAW' },
    body: { values: [values] },
  })
}

/** Full-width row (so writing it back also clears cells that became empty). */
const padRow = (tab, row) => {
  const width = HEADERS[tab].length
  const out = [...(row || [])].slice(0, width)
  while (out.length < width) out.push('')
  return out
}

/** Rebuild an appointment's raw row from its fields after a change. */
function syncRaw(a, updated) {
  a.raw = appointmentToRow(a, a.raw?.[A.CREATED] ?? updated, updated)
}

/* ---------------- history (undo) ---------------- */

let user = ''
let lastEntry = null
export const setUser = (email) => (user = email || '')
/** ID of the most recent history entry written by this device (for "Undo" toasts). */
export const lastEntryId = () => lastEntry

/**
 * Records a change: `before` = { appts: { id: rowOrNull }, emps: { id: rowOrNull } }
 * — the rows as they were before (null = didn't exist yet).
 */
async function logChange(action, summary, before) {
  lastEntry = null
  try {
    const json = JSON.stringify(before)
    const chunks = []
    for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK))
    const tooBig = chunks.length > 10
    const id = uuid()
    await appendRow(HISTORY, padRow(HISTORY, [
      id, new Date().toISOString(), user, action, summary + (tooBig ? ' (too large to undo)' : ''), '',
      ...(tooBig ? ['{"tooBig":true}'] : chunks),
    ]))
    lastEntry = id
  } catch (err) {
    // The change itself succeeded; never fail it because the log couldn't be written.
    console.warn('Could not write history', err)
  }
}

async function readHistory() {
  const res = await sheetsApi(`/${db.id}/values/${enc(range(HISTORY, 'A2:P'))}`)
  return (res.values || [])
    .map((r, i) => ({
      id: clean(r[0]), time: clean(r[1]), who: clean(r[2]), action: clean(r[3]), summary: clean(r[4]),
      undoneAt: clean(r[5]), row: i + 2, data: r.slice(6).join(''),
    }))
    .filter((e) => e.id)
}

/** History entries, newest first (without the stored rows). */
export function getHistory() {
  return serial(async () => (await readHistory()).reverse().map(({ data, row, ...e }) => e))
}

/** Writes rows back to the state in `wanted` ({ id: rowOrNull }) for one tab. */
async function applyState(tab, wanted) {
  const ids = Object.keys(wanted)
  if (!ids.length) return
  const existing = listFor(tab).filter((x) => x.id in wanted)
  if (existing.length) await locateRows(tab, existing)
  const have = new Set(existing.map((x) => x.id))
  const updates = existing.filter((x) => wanted[x.id]).map((x) => ({ range: range(tab, `A${x.row}:${LAST_COL[tab]}${x.row}`), values: [padRow(tab, wanted[x.id])] }))
  const appends = ids.filter((id) => !have.has(id) && wanted[id]).map((id) => padRow(tab, wanted[id]))
  const deletes = existing.filter((x) => !wanted[x.id]).map((x) => x.row).sort((a, b) => b - a)
  if (updates.length) await sheetsApi(`/${db.id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data: updates } })
  if (appends.length) {
    await sheetsApi(`/${db.id}/values/${enc(range(tab, `A:${LAST_COL[tab]}`))}:append`, {
      method: 'POST', query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { values: appends },
    })
  }
  if (deletes.length) {
    await sheetsApi(`/${db.id}:batchUpdate`, {
      method: 'POST',
      body: { requests: deletes.map((r) => ({ deleteDimension: { range: { sheetId: db.gids[tab], dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })) },
    })
  }
}

/**
 * Rolls back the given entry and every later change that hasn't been undone yet,
 * restoring each touched row to how it was just before that entry. The rollback is
 * itself logged, so it can be undone too.
 */
export function rollback(entryId) {
  return serial(async () => {
    await load()
    const list = await readHistory()
    const target = list.find((e) => e.id === entryId)
    if (!target) throw new Error('That change was not found in the History tab.')
    // Every entry from that moment on — including ones already undone — newest first. Each entry holds
    // the rows exactly as they were just before it, so the oldest entry touching a row tells us how
    // that row looked at that moment, whatever happened (or was undone) in between.
    const span = list.filter((e) => e.time >= target.time).sort((a, b) => (a.time < b.time ? 1 : -1))
    const toUndo = span.filter((e) => !e.undoneAt)
    if (!toUndo.length) throw new Error('That change has already been undone.')

    // Newest → oldest, so the oldest entry's "before" wins for each row.
    const wanted = Object.fromEntries(Object.keys(KIND_TAB).map((k) => [k, {}]))
    for (const e of span) {
      let d
      try { d = JSON.parse(e.data || '{}') } catch { d = { tooBig: true } }
      if (d.tooBig) throw new Error(`"${e.summary}" was too large to undo automatically. Use File → Version history in the Google Sheet.`)
      for (const kind in wanted) Object.assign(wanted[kind], d[kind] || {})
    }
    // What things look like now, so the rollback itself can be undone.
    const now = {}
    for (const kind in wanted) {
      const list = listFor(KIND_TAB[kind])
      now[kind] = Object.fromEntries(Object.keys(wanted[kind]).map((id) => [id, list.find((x) => x.id === id)?.raw ?? null]))
    }
    for (const kind of ['appts', 'svcs', 'leave', 'pays', 'emps']) await applyState(KIND_TAB[kind], wanted[kind])
    const stamp = new Date().toISOString()
    await sheetsApi(`/${db.id}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'RAW', data: toUndo.map((e) => ({ range: range(HISTORY, `F${e.row}`), values: [[stamp]] })) },
    })
    const n = toUndo.length
    await logChange('rollback', n === 1 ? `Undid: ${toUndo[0].summary}` : `Undid ${n} changes (back to before "${target.summary}")`, now)
    await load()
    return n
  })
}

/* ---------------- opening / creating the sheet ---------------- */

async function readMeta(id) {
  return sheetsApi(`/${id}`, { query: { fields: 'spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)' } })
}

/** Adds any missing tabs (with headers) so a blank or older sheet works too. */
async function ensureTabs(meta) {
  const titles = meta.sheets.map((s) => s.properties.title)
  const missing = TABS.filter((t) => !titles.includes(t))
  if (!missing.length) return meta
  await sheetsApi(`/${meta.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
  })
  const data = missing.map((t) => ({ range: range(t, 'A1'), values: [HEADERS[t]] }))
  if (missing.includes(SETTINGS)) data.push({ range: range(SETTINGS, 'A2'), values: [[MONTH_START_SETTING, 1]] })
  await sheetsApi(`/${meta.spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'RAW', data },
  })
  return readMeta(meta.spreadsheetId)
}

async function load() {
  const DATA = [EMPLOYEES, APPOINTMENTS, SERVICES, LEAVE, PAYSLIPS]
  const res = await sheetsApi(`/${db.id}/values:batchGet`, {
    query: {
      ranges: [
        ...DATA.map((t) => range(t, `A2:${LAST_COL[t]}`)),
        range(SETTINGS, 'A2:B'),
        ...DATA.map((t) => range(t, `A1:${LAST_COL[t]}1`)),
      ],
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    },
  })
  const vals = res.valueRanges.map((vr) => vr.values || [])
  const [emps, appts, services, leave, payslips, settings] = vals
  await migrateLeaveColumn(vals[6][0] || [], emps)
  // Sheets made by an older version: add the newer column headers.
  const fix = DATA.filter((t, i) => (vals[6 + i][0] || []).length < HEADERS[t].length)
  if (fix.length) {
    await sheetsApi(`/${db.id}/values:batchUpdate`, {
      method: 'POST', body: { valueInputOption: 'RAW', data: fix.map((t) => ({ range: range(t, 'A1'), values: [HEADERS[t]] })) },
    })
  }
  const rows = (list, fn) => list.map((r, i) => (clean(r[0]) ? fn(r, i + 2) : null)).filter(Boolean)
  db.services = rows(services, rowToService)
  db.employees = rows(emps, rowToEmployee)
  db.appts = rows(appts, rowToAppointment)
  db.leave = rows(leave, rowToLeave)
  db.payslips = rows(payslips, rowToPayslip)
  const setting = (name) => settings.find((r) => clean(r[0]).toLowerCase() === name.toLowerCase())?.[1]
  const day = parseInt(setting(MONTH_START_SETTING), 10)
  db.startDay = day >= 1 && day <= 28 ? day : 1
  db.company = Object.fromEntries(COMPANY_FIELDS.map(([key, label]) => [key, String(setting(label) ?? '').trim()]))
}

/**
 * Sheets from before annual leave was set in hours per year: turn "days per month" into hours per year
 * (days × 12 × hours a day) and rename the column. Runs once.
 */
async function migrateLeaveColumn(header, emps) {
  const col = 6 + PAY_FIELDS.findIndex((f) => f[0] === 'leavePerYear')
  if (clean(header[col]) !== OLD_LEAVE_HEADER) return
  const perDayCol = 6 + PAY_FIELDS.findIndex((f) => f[0] === 'hoursPerDay')
  const values = emps.map((r) => {
    const v = r[col]
    if (v === '' || v == null || !Number.isFinite(Number(v))) return ['']
    return [Math.round(Number(v) * 12 * (Number(r[perDayCol]) || 8) * 100) / 100]
  })
  emps.forEach((r, i) => { if (r.length > col) r[col] = values[i][0] })
  const letter = colLetter(col + 1)
  await sheetsApi(`/${db.id}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: [
        { range: range(EMPLOYEES, 'A1'), values: [EMPLOYEE_HEADERS] },
        ...(values.length ? [{ range: range(EMPLOYEES, `${letter}2:${letter}${values.length + 1}`), values }] : []),
      ],
    },
  })
}

/** Opens a sheet by link or ID, adding missing tabs, and loads everything. */
export async function openSheet(idOrUrl) {
  const id = parseSheetId(idOrUrl)
  if (!id) throw new Error('That doesn\'t look like a Google Sheets link.')
  const meta = await ensureTabs(await readMeta(id))
  db.id = id
  db.url = meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit`
  db.gids = Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]))
  await load()
  return id
}

/** Creates a new, empty "Little Lash Lounge Payments" sheet in the signed-in user's Drive. */
export async function createSheet() {
  const meta = await sheetsApi('', {
    method: 'POST',
    body: {
      properties: { title: TITLE },
      sheets: TABS.map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
    },
  })
  await sheetsApi(`/${meta.spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: [
        ...TABS.map((t) => ({ range: range(t, 'A1'), values: [HEADERS[t]] })),
        { range: range(SETTINGS, 'A2'), values: [[MONTH_START_SETTING, 1]] },
      ],
    },
  })
  return meta.spreadsheetId
}

export const reload = () => serial(load)

/* ---------------- API used by the store ---------------- */

export function getInitialData() {
  return {
    employees: publicEmployees(), services: publicServices(), spreadsheetUrl: db.url, monthStartDay: db.startDay,
    leave: publicLeave(), payslips: publicPayslips(), company: { ...db.company },
  }
}

/** period: 'YYYY-MM' (one business month) or 'YYYY' (a year). */
export function getAppointments(period) {
  return db.appts.filter((a) => a.month.startsWith(period)).map(publicAppt)
}

function validateAppointment(input) {
  const date = clean(input.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Please choose a valid date.')
  const employee = db.employees.find((e) => e.id === input.employeeId)
  if (!employee) throw new Error('Please choose an employee.')
  const amount = Math.round(parseFloat(String(input.amount).replace(',', '.')) * 100) / 100
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Please enter a valid amount.')
  if (!METHODS.includes(input.method)) throw new Error('Please choose Cash, Card or EFT.')
  return {
    date,
    employeeId: employee.id,
    employeeName: employee.name,
    client: clean(input.client),
    service: clean(input.service),
    amount,
    method: input.method,
    status: input.status === 'Paid' ? 'Paid' : 'Unpaid',
    notes: clean(input.notes),
    overtime: overtimeValue(input.overtime),
    length: Number(input.length) > 0 ? Math.round(Number(input.length)) : 0,
  }
}

export function saveAppointment(input) {
  return serial(() => guarded(async () => {
    const v = validateAppointment(input)
    const now = new Date().toISOString()
    const existing = input.id ? db.appts.find((a) => a.id === input.id) : null
    if (input.id && !existing) throw new StaleError('Appointment not found.')

    const appt = {
      ...v,
      id: existing?.id || uuid(),
      // Keep the business month unless the date changed.
      month: existing && existing.date === v.date ? existing.month : businessMonth(v.date, db.startDay),
      paidOn: v.status === 'Paid' ? (existing?.status === 'Paid' && existing.paidOn) || todayStr() : '',
    }
    const label = `${appt.client || 'client'} · ${fmt0(appt.amount)} · ${appt.employeeName} · ${appt.date.slice(8)}/${appt.date.slice(5, 7)}`
    if (existing) {
      await locateRows(APPOINTMENTS, [existing])
      const before = [...existing.raw]
      const created = existing.raw[A.CREATED] ?? now
      const values = appointmentToRow(appt, created, now)
      await writeRow(APPOINTMENTS, existing.row, values)
      Object.assign(existing, appt, { raw: values })
      await logChange('edit', `Edited ${label}`, { appts: { [appt.id]: before } })
      return publicAppt(existing)
    }
    const values = appointmentToRow(appt, now, now)
    const row = await appendRow(APPOINTMENTS, values)
    const saved = { ...appt, row, raw: values }
    db.appts.push(saved)
    await logChange('add', `Added ${label}`, { appts: { [appt.id]: null } })
    return publicAppt(saved)
  }))
}

/** Bulk-change status and/or method. */
export function updateAppointments(ids, changes = {}) {
  return serial(() => guarded(async () => {
    if (changes.method && !METHODS.includes(changes.method)) throw new Error('Invalid payment method.')
    const wanted = new Set(ids)
    const items = db.appts.filter((a) => wanted.has(a.id))
    if (!items.length) return []
    await locateRows(APPOINTMENTS, items)
    const before = Object.fromEntries(items.map((a) => [a.id, [...a.raw]]))
    const now = new Date().toISOString()
    const today = todayStr()
    const data = []
    for (const a of items) {
      if (changes.method) a.method = changes.method
      if (changes.status) {
        if (changes.status === 'Paid' && a.status !== 'Paid') a.paidOn = today
        if (changes.status === 'Unpaid') a.paidOn = ''
        a.status = changes.status === 'Paid' ? 'Paid' : 'Unpaid'
      }
      // Method, Status, Paid On are adjacent (I:K); Updated At is N.
      data.push({ range: range(APPOINTMENTS, `I${a.row}:K${a.row}`), values: [[a.method, a.status, a.paidOn]] })
      data.push({ range: range(APPOINTMENTS, `N${a.row}`), values: [[now]] })
    }
    await sheetsApi(`/${db.id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } })
    items.forEach((a) => syncRaw(a, now))
    const what = [changes.status && `marked ${changes.status.toLowerCase()}`, changes.method && `set to ${changes.method}`].filter(Boolean).join(' and ')
    const who = items.length === 1 ? `${items[0].client || 'Appointment'} (${fmt0(items[0].amount)})` : `${items.length} appointments`
    await logChange('update', `${who} ${what}`, { appts: before })
    return items.map(publicAppt)
  }))
}

/** Sets the client name on these appointments (rename a client, or merge two into one). */
export function renameClients(ids, name, summary) {
  return serial(() => guarded(async () => {
    name = clean(name)
    if (!name) throw new Error('Please enter a name.')
    const wanted = new Set(ids)
    const items = db.appts.filter((a) => wanted.has(a.id))
    if (!items.length) return []
    await locateRows(APPOINTMENTS, items)
    const before = Object.fromEntries(items.map((a) => [a.id, [...a.raw]]))
    const now = new Date().toISOString()
    const data = items.flatMap((a) => [
      { range: range(APPOINTMENTS, `F${a.row}`), values: [[name]] },
      { range: range(APPOINTMENTS, `N${a.row}`), values: [[now]] },
    ])
    await sheetsApi(`/${db.id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } })
    items.forEach((a) => {
      a.client = name
      syncRaw(a, now)
    })
    await logChange('clients', summary || `Renamed client to ${name}`, { appts: before })
    return items.map(publicAppt)
  }))
}

export function deleteAppointment(id) {
  return serial(() => guarded(async () => {
    const a = db.appts.find((x) => x.id === id)
    if (!a) return true
    await locateRows(APPOINTMENTS, [a])
    await deleteRow(APPOINTMENTS, a.row)
    db.appts = db.appts.filter((x) => x !== a)
    shiftRowsAfter(db.appts, a.row)
    await logChange('delete', `Deleted ${a.client || 'client'} · ${fmt0(a.amount)} · ${a.date.slice(8)}/${a.date.slice(5, 7)}`, { appts: { [a.id]: [...a.raw] } })
    return true
  }))
}

export function saveEmployee(input) {
  return serial(() => guarded(async () => {
    const name = clean(input?.name)
    if (!name) throw new Error('Please enter the employee\'s name.')
    const phone = clean(input.phone)
    const now = new Date().toISOString()
    if (input.id) {
      const emp = db.employees.find((e) => e.id === input.id)
      if (!emp) throw new StaleError('Employee not found.')
      const pay = payCells(input.pay || emp.pay)
      await locateRows(EMPLOYEES, [emp])
      const before = [...emp.raw]
      const values = [emp.id, name, phone, input.active !== false, emp.raw[E.CREATED] ?? now, now, ...pay]
      await writeRow(EMPLOYEES, emp.row, values)
      const renamed = emp.name !== name
      Object.assign(emp, rowToEmployee(values, emp.row))
      const apptsBefore = renamed ? await renameInAppointments(emp.id, name) : {}
      await logChange('team', `Updated team member ${name}`, { emps: { [emp.id]: before }, appts: apptsBefore })
    } else {
      const values = [uuid(), name, phone, true, now, now, ...payCells(input.pay)]
      const row = await appendRow(EMPLOYEES, values)
      db.employees.push(rowToEmployee(values, row))
      await logChange('team', `Added team member ${name}`, { emps: { [values[0]]: null } })
    }
    return publicEmployees()
  }))
}

/** Keeps the readable "Employee" column in the sheet in step with a rename. Returns { id: rowBefore } of changed rows. */
async function renameInAppointments(employeeId, name) {
  const before = Object.fromEntries(db.appts.filter((a) => a.employeeId === employeeId && a.raw?.[A.EMPLOYEE] !== name).map((a) => [a.id, [...a.raw]]))
  const res = await sheetsApi(`/${db.id}/values/${enc(range(APPOINTMENTS, 'D2:E'))}`)
  const rows = res.values || []
  let changed = false
  const col = rows.map((r) => {
    if (clean(r[0]) === employeeId && clean(r[1]) !== name) {
      changed = true
      return [name]
    }
    return [r[1] ?? '']
  })
  if (!changed) return {}
  await sheetsApi(`/${db.id}/values/${enc(range(APPOINTMENTS, `E2:E${rows.length + 1}`))}`, {
    method: 'PUT',
    query: { valueInputOption: 'RAW' },
    body: { values: col },
  })
  db.appts.forEach((a) => {
    if (a.employeeId === employeeId) {
      a.employeeName = name
      if (a.raw) a.raw[A.EMPLOYEE] = name
    }
  })
  return before
}

export function deleteEmployee(id) {
  return serial(() => guarded(async () => {
    if (db.appts.some((a) => a.employeeId === id)) {
      throw new Error('This employee has appointments. Mark her as inactive instead of deleting.')
    }
    const emp = db.employees.find((e) => e.id === id)
    if (emp) {
      await locateRows(EMPLOYEES, [emp])
      await deleteRow(EMPLOYEES, emp.row)
      db.employees = db.employees.filter((e) => e !== emp)
      shiftRowsAfter(db.employees, emp.row)
      await logChange('team', `Removed team member ${emp.name}`, { emps: { [emp.id]: [...emp.raw] } })
    }
    return publicEmployees()
  }))
}

/* ---------------- services ---------------- */

/** Adds or edits a service in the Services tab. Renaming also renames it on past appointments. */
export function saveService(input) {
  return serial(() => guarded(async () => {
    const name = clean(input?.name).replace(/\s*\+\s*/g, ' & ')
    if (!name) throw new Error('Please enter the service name.')
    const price = cleanPrice(input.price)
    if (price !== '' && !(price >= 0)) throw new Error('Please enter a valid price.')
    if (Object.values(input.prices || {}).some((v) => v !== '' && v != null && !(cleanPrice(v) >= 0))) throw new Error('Please enter valid prices.')
    const team = pricesCell(input.prices)
    const active = input.active !== false
    const now = new Date().toISOString()
    const clash = db.services.find((x) => serviceKey(x.name) === serviceKey(name) && x.id !== input.id)
    if (clash) throw new Error(`There is already a service called "${clash.name}". Use Merge to combine them.`)
    const existing = input.id ? db.services.find((x) => x.id === input.id) : null
    const before = { svcs: {}, appts: {} }
    if (existing) {
      await locateRows(SERVICES, [existing])
      before.svcs[existing.id] = [...existing.raw]
      const values = [existing.id, name, price, active, existing.raw[S.CREATED] ?? now, now, team]
      await writeRow(SERVICES, existing.row, values)
      const oldName = existing.name
      Object.assign(existing, rowToService(values, existing.row))
      if (serviceKey(oldName) !== serviceKey(name) || oldName !== name) Object.assign(before.appts, await replaceInAppointments([oldName], name, now))
      await logChange('services', oldName !== name ? `Renamed service "${oldName}" to "${name}"` : `Updated service ${name}`, before)
    } else {
      const values = [input.newId || uuid(), name, price, active, now, now, team]
      const row = await appendRow(SERVICES, values)
      db.services.push(rowToService(values, row))
      before.svcs[values[0]] = null
      // Adopting a name that past appointments already use (e.g. from the Services page): tidy their spelling.
      if (input.fromNames?.length) Object.assign(before.appts, await replaceInAppointments(input.fromNames, name, now))
      await logChange('services', `Added service ${name}${price !== '' ? ' · ' + fmt0(price) : ''}`, before)
    }
    return { services: publicServices(), appts: Object.keys(before.appts).map((id) => publicAppt(db.appts.find((a) => a.id === id))).filter(Boolean) }
  }))
}

/**
 * Merges several service names into one (e.g. "halfset lashes" + "Half set lashes").
 * Past appointments are updated, and the Services tab keeps a single entry.
 */
export function mergeServices(fromNames, toName, summary) {
  return serial(() => guarded(async () => {
    toName = clean(toName).replace(/\s*\+\s*/g, ' & ')
    if (!toName) throw new Error('Please enter a name.')
    const now = new Date().toISOString()
    const keys = new Set([...fromNames, toName].map(serviceKey))
    const before = { svcs: {}, appts: {} }
    // Services tab: keep one entry (the first that matches), remove the others.
    const rows = db.services.filter((x) => keys.has(serviceKey(x.name)))
    const keep = rows[0]
    const drop = rows.slice(1)
    if (rows.length) await locateRows(SERVICES, rows)
    if (keep) {
      before.svcs[keep.id] = [...keep.raw]
      const price = keep.price ?? drop.find((d) => d.price != null)?.price ?? ''
      const team = pricesCell(Object.assign({}, ...[...drop].reverse().map((d) => d.prices), keep.prices))
      const values = [keep.id, toName, price, keep.active || drop.some((d) => d.active), keep.raw[S.CREATED] ?? now, now, team]
      await writeRow(SERVICES, keep.row, values)
      Object.assign(keep, rowToService(values, keep.row))
    }
    if (drop.length) {
      drop.forEach((d) => (before.svcs[d.id] = [...d.raw]))
      await sheetsApi(`/${db.id}:batchUpdate`, {
        method: 'POST',
        body: { requests: drop.map((d) => d.row).sort((a, b) => b - a).map((r) => ({ deleteDimension: { range: { sheetId: db.gids[SERVICES], dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })) },
      })
      const gone = new Set(drop)
      db.services = db.services.filter((x) => !gone.has(x))
      for (const d of [...drop].sort((a, b) => b.row - a.row)) shiftRowsAfter(db.services, d.row)
    }
    Object.assign(before.appts, await replaceInAppointments([...fromNames, toName], toName, now))
    await logChange('services', summary || `Merged services into "${toName}"`, before)
    return { services: publicServices(), appts: Object.keys(before.appts).map((id) => publicAppt(db.appts.find((a) => a.id === id))).filter(Boolean) }
  }))
}

/** Replaces service names inside appointments' Service cells. Returns { id: rowBefore } of the changed ones. */
async function replaceInAppointments(fromNames, toName, now) {
  const keys = new Set(fromNames.map(serviceKey))
  const renamed = (a) => joinServices(splitServices(a.service).map((t) => (keys.has(serviceKey(t)) ? toName : t)))
  const items = db.appts.filter((a) => renamed(a) !== a.service)
  if (!items.length) return {}
  await locateRows(APPOINTMENTS, items)
  const before = Object.fromEntries(items.map((a) => [a.id, [...a.raw]]))
  const data = []
  for (const a of items) {
    a.service = renamed(a)
    data.push({ range: range(APPOINTMENTS, `G${a.row}`), values: [[a.service]] })
    data.push({ range: range(APPOINTMENTS, `N${a.row}`), values: [[now]] })
    syncRaw(a, now)
  }
  for (let i = 0; i < data.length; i += 4000) {
    await sheetsApi(`/${db.id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data: data.slice(i, i + 4000) } })
  }
  return before
}

/**
 * Adds many services to the Services tab at once (e.g. every service used on past
 * appointments), each with prices per team member. Names already on the list are skipped.
 */
export function importServices(items) {
  return serial(() => guarded(async () => {
    const now = new Date().toISOString()
    const have = new Set(db.services.map((x) => serviceKey(x.name)))
    const rows = []
    for (const it of items) {
      const name = clean(it.name).replace(/\s*\+\s*/g, ' & ')
      const key = serviceKey(name)
      if (!name || have.has(key)) continue
      have.add(key)
      rows.push([uuid(), name, cleanPrice(it.price), true, now, now, pricesCell(it.prices)])
    }
    if (!rows.length) return { services: publicServices(), added: 0 }
    const res = await sheetsApi(`/${db.id}/values/${enc(range(SERVICES, 'A:G'))}:append`, {
      method: 'POST', query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { values: rows },
    })
    const first = rowOf(res.updates.updatedRange)
    rows.forEach((r, i) => db.services.push(rowToService(r, first + i)))
    await logChange('services', `Added ${rows.length} past services to the list, linked to the team`, { svcs: Object.fromEntries(rows.map((r) => [r[0], null])) })
    return { services: publicServices(), added: rows.length }
  }))
}

/* ---------------- leave & payslips ---------------- */

/** Adds (no id) or replaces a row in a simple tab, logging it for undo. Returns the saved record. */
async function upsertRow(tab, kind, list, id, makeValues, toRecord, summary) {
  const now = new Date().toISOString()
  const existing = id ? list().find((x) => x.id === id) : null
  if (id && !existing) throw new StaleError('That was changed on another device.')
  if (existing) {
    await locateRows(tab, [existing])
    const before = [...existing.raw]
    const values = makeValues(existing.id, existing.raw[HEADERS[tab].length - 2] || now, now)
    await writeRow(tab, existing.row, values)
    Object.assign(existing, toRecord(values, existing.row))
    await logChange(kind, summary, { [kind]: { [existing.id]: before } })
    return strip(existing)
  }
  const values = makeValues(uuid(), now, now)
  const row = await appendRow(tab, values)
  const rec = toRecord(values, row)
  list().push(rec)
  await logChange(kind, summary, { [kind]: { [rec.id]: null } })
  return strip(rec)
}

async function removeRow(tab, kind, key, id, summary) {
  const item = db[key].find((x) => x.id === id)
  if (!item) return
  await locateRows(tab, [item])
  await deleteRow(tab, item.row)
  db[key] = db[key].filter((x) => x !== item)
  shiftRowsAfter(db[key], item.row)
  await logChange(kind, summary(item), { [kind]: { [item.id]: [...item.raw] } })
}

const ddmm = (d) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : '')

/** Books (or edits) leave: { id?, employeeId, type, from, to, hours, notes }. */
export function saveLeave(input) {
  return serial(() => guarded(async () => {
    const emp = db.employees.find((e) => e.id === input.employeeId)
    if (!emp) throw new Error('Please choose who is taking leave.')
    const from = clean(input.from)
    const to = clean(input.to) || from
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new Error('Please choose valid dates.')
    const hours = Math.round(parseFloat(String(input.hours).replace(',', '.')) * 100) / 100
    if (!(hours > 0)) throw new Error('Please enter the hours of leave.')
    const type = LEAVE_TYPES.includes(input.type) ? input.type : 'Annual'
    const summary = `${input.id ? 'Changed' : 'Booked'} ${type.toLowerCase()} leave · ${emp.name} · ${ddmm(from)}${to !== from ? '–' + ddmm(to) : ''} · ${hours} h`
    await upsertRow(LEAVE, 'leave', () => db.leave, input.id,
      (id, created, now) => [id, emp.id, emp.name, type, from, to, hours, clean(input.notes), created, now], rowToLeave, summary)
    return publicLeave()
  }))
}

export function deleteLeave(id) {
  return serial(() => guarded(async () => {
    await removeRow(LEAVE, 'leave', 'leave', id, (l) => `Removed ${l.type.toLowerCase()} leave · ${l.employeeName} · ${ddmm(l.from)}`)
    return publicLeave()
  }))
}

/** Saves a payslip (one per employee per month; saving again replaces it). */
export function savePayslip(slip) {
  return serial(() => guarded(async () => {
    const emp = db.employees.find((e) => e.id === slip.employeeId)
    if (!emp) throw new Error('Employee not found.')
    const existing = db.payslips.find((p) => p.employeeId === slip.employeeId && p.month === slip.month)
    const otherDed = slip.deductions.filter((d) => d.label !== 'PAYE' && d.label !== 'UIF').reduce((s, d) => s + d.amount, 0)
    const pick = (label) => slip.deductions.find((d) => d.label === label)?.amount || 0
    const summary = `${existing ? 'Updated' : 'Made'} payslip · ${emp.name} · ${slip.month} · net ${fmt0(slip.net)}`
    const saved = await upsertRow(PAYSLIPS, 'pays', () => db.payslips, existing?.id,
      (id, created, now) => [id, emp.id, emp.name, slip.month, slip.payDate, slip.gross, pick('PAYE'), pick('UIF'), Math.round(otherDed * 100) / 100, slip.net,
        JSON.stringify({ ...slip, id }), created, now],
      rowToPayslip, summary)
    return { saved, payslips: publicPayslips() }
  }))
}

export function deletePayslip(id) {
  return serial(() => guarded(async () => {
    await removeRow(PAYSLIPS, 'pays', 'payslips', id, (p) => `Deleted payslip · ${p.employeeName} · ${p.month}`)
    return publicPayslips()
  }))
}

/** Saves the company details shown on payslips (Settings tab). */
export function saveCompany(company) {
  return serial(async () => {
    const res = await sheetsApi(`/${db.id}/values/${enc(range(SETTINGS, 'A2:B'))}`)
    const rows = res.values || []
    const data = []
    const appends = []
    for (const [key, label] of COMPANY_FIELDS) {
      const value = String(company[key] ?? '').replace(/\r/g, '').trim()
      const i = rows.findIndex((r) => clean(r[0]).toLowerCase() === label.toLowerCase())
      if (i >= 0) data.push({ range: range(SETTINGS, `B${i + 2}`), values: [[value]] })
      else appends.push([label, value])
    }
    if (data.length) await sheetsApi(`/${db.id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } })
    if (appends.length) {
      await sheetsApi(`/${db.id}/values/${enc(range(SETTINGS, 'A:B'))}:append`, {
        method: 'POST', query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { values: appends },
      })
    }
    db.company = Object.fromEntries(COMPANY_FIELDS.map(([key]) => [key, String(company[key] ?? '').trim()]))
    return { ...db.company }
  })
}

/** Reads the old Google Sheets payslips (one tab per person) from another sheet, for filling in details. */
export async function readOldPayslips(idOrUrl) {
  const id = parseSheetId(idOrUrl)
  if (!id) throw new Error('That doesn\'t look like a Google Sheets link.')
  const meta = await readMeta(id)
  const titles = meta.sheets.map((s) => s.properties.title)
  if (!titles.length) return []
  const res = await sheetsApi(`/${id}/values:batchGet`, {
    query: { ranges: titles.map((t) => range(t, 'A1:F80')), valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' },
  })
  return res.valueRanges.map((vr, i) => parsePayslipTab(titles[i], vr.values || [])).filter((x) => x.pay.fullName || x.earnings.length)
}
