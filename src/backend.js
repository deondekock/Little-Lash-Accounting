/**
 * Data layer: the Google Sheet is the database.
 *
 * Tabs (same layout the old Apps Script version created, so existing sheets keep working):
 *   Employees    ID | Name | Phone | Active | Created At | Updated At
 *   Appointments ID | Date | Month | Employee ID | Employee | Client | Service |
 *                Amount | Method | Status | Paid On | Notes | Created At | Updated At
 *   Settings     Setting | Value      ("Month starts on day" → 26 = months run 26th–25th)
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

export const METHODS = ['Cash', 'Card', 'EFT']
const TITLE = 'Little Lash Lounge Payments'
const EMPLOYEES = 'Employees'
const APPOINTMENTS = 'Appointments'
const SETTINGS = 'Settings'
const HISTORY = 'History'
const MONTH_START_SETTING = 'Month starts on day'

const EMPLOYEE_HEADERS = ['ID', 'Name', 'Phone', 'Active', 'Created At', 'Updated At']
const APPOINTMENT_HEADERS = [
  'ID', 'Date', 'Month', 'Employee ID', 'Employee', 'Client', 'Service',
  'Amount', 'Method', 'Status', 'Paid On', 'Notes', 'Created At', 'Updated At',
]
const HISTORY_HEADERS = ['ID', 'Time', 'Who', 'Action', 'Summary', 'Undone At',
  ...Array.from({ length: 10 }, (_, i) => `Data ${i + 1}`)]
const HEADERS = { [EMPLOYEES]: EMPLOYEE_HEADERS, [APPOINTMENTS]: APPOINTMENT_HEADERS, [SETTINGS]: ['Setting', 'Value'], [HISTORY]: HISTORY_HEADERS }
const LAST_COL = { [EMPLOYEES]: 'F', [APPOINTMENTS]: 'N', [SETTINGS]: 'B', [HISTORY]: 'P' }
const TABS = [EMPLOYEES, APPOINTMENTS, SETTINGS, HISTORY]
const CHUNK = 45000 // a cell holds up to 50,000 characters

// Zero-based column indexes.
const A = {
  ID: 0, DATE: 1, MONTH: 2, EMPLOYEE_ID: 3, EMPLOYEE: 4, CLIENT: 5, SERVICE: 6,
  AMOUNT: 7, METHOD: 8, STATUS: 9, PAID_ON: 10, NOTES: 11, CREATED: 12, UPDATED: 13,
}
const E = { ID: 0, NAME: 1, PHONE: 2, ACTIVE: 3, CREATED: 4, UPDATED: 5 }

const db = {
  id: '',
  url: '',
  gids: {}, // tab title → numeric sheetId (needed to delete rows)
  startDay: 1,
  employees: [], // { id, name, phone, active, row, raw }
  appts: [], // { ...appointment, row, raw }
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
  return {
    id: clean(r[E.ID]),
    name: clean(r[E.NAME]),
    phone: clean(r[E.PHONE]),
    active: active === true || String(active).toUpperCase() === 'TRUE',
    row,
    raw: r,
  }
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
    row,
    raw: r,
  }
}

function appointmentToRow(a, created, updated) {
  return [a.id, a.date, a.month, a.employeeId, a.employeeName, a.client, a.service,
    a.amount, a.method, a.status, a.paidOn, a.notes, created, updated]
}

/** Public copy (no sheet internals), with the employee's current name. */
function publicAppt(a) {
  const { row, raw, ...rest } = a
  return { ...rest, employeeName: db.employees.find((e) => e.id === a.employeeId)?.name || a.employeeName }
}

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
  const list = tab === APPOINTMENTS ? db.appts : db.employees
  for (const x of list) x.row = index.get(x.id) || x.row
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
  const list = tab === APPOINTMENTS ? db.appts : db.employees
  const existing = list.filter((x) => x.id in wanted)
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
    const toUndo = list.filter((e) => !e.undoneAt && e.time >= target.time).sort((a, b) => (a.time < b.time ? 1 : -1))
    if (!toUndo.length) throw new Error('That change has already been undone.')

    // Newest → oldest, so the oldest entry's "before" wins for each row.
    const appts = {}
    const emps = {}
    for (const e of toUndo) {
      let d
      try { d = JSON.parse(e.data || '{}') } catch { d = { tooBig: true } }
      if (d.tooBig) throw new Error(`"${e.summary}" was too large to undo automatically. Use File → Version history in the Google Sheet.`)
      Object.assign(appts, d.appts || {})
      Object.assign(emps, d.emps || {})
    }
    // What things look like now, so the rollback itself can be undone.
    const now = {
      appts: Object.fromEntries(Object.keys(appts).map((id) => [id, db.appts.find((a) => a.id === id)?.raw ?? null])),
      emps: Object.fromEntries(Object.keys(emps).map((id) => [id, db.employees.find((e) => e.id === id)?.raw ?? null])),
    }
    await applyState(APPOINTMENTS, appts)
    await applyState(EMPLOYEES, emps)
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
  const res = await sheetsApi(`/${db.id}/values:batchGet`, {
    query: {
      ranges: [range(EMPLOYEES, 'A2:F'), range(APPOINTMENTS, 'A2:N'), range(SETTINGS, 'A2:B')],
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    },
  })
  const [emps, appts, settings] = res.valueRanges.map((vr) => vr.values || [])
  db.employees = emps.map((r, i) => (clean(r[0]) ? rowToEmployee(r, i + 2) : null)).filter(Boolean)
  db.appts = appts.map((r, i) => (clean(r[0]) ? rowToAppointment(r, i + 2) : null)).filter(Boolean)
  const start = settings.find((r) => clean(r[0]).toLowerCase() === MONTH_START_SETTING.toLowerCase())
  const day = parseInt(start?.[1], 10)
  db.startDay = day >= 1 && day <= 28 ? day : 1
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
  return { employees: publicEmployees(), spreadsheetUrl: db.url, monthStartDay: db.startDay }
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
      await locateRows(EMPLOYEES, [emp])
      const before = [...emp.raw]
      const values = [emp.id, name, phone, input.active !== false, emp.raw[E.CREATED] ?? now, now]
      await writeRow(EMPLOYEES, emp.row, values)
      const renamed = emp.name !== name
      Object.assign(emp, { name, phone, active: input.active !== false, raw: values })
      if (renamed) await renameInAppointments(emp.id, name)
      await logChange('team', `Updated team member ${name}`, { emps: { [emp.id]: before } })
    } else {
      const values = [uuid(), name, phone, true, now, now]
      const row = await appendRow(EMPLOYEES, values)
      db.employees.push(rowToEmployee(values, row))
      await logChange('team', `Added team member ${name}`, { emps: { [values[0]]: null } })
    }
    return publicEmployees()
  }))
}

/** Keeps the readable "Employee" column in the sheet in step with a rename. */
async function renameInAppointments(employeeId, name) {
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
  if (!changed) return
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
