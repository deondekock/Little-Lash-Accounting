/**
 * Data layer on Cloudflare (D1 database behind the Worker in /worker).
 * Same functions as the Google Sheets data layer (backend.js), so the screens don't care which is used.
 *
 * Everything is loaded once and kept in memory; each change is sent as one all-or-nothing write
 * with a history entry holding the records as they were before, so any change can be undone.
 */
import { API_URL } from './config.js'
import { getToken, googleToken, sessionToken, saveSession, clearSession } from './google/auth.js'
import { FAKE_API } from './config.js'
import { AuthError } from './google/sheets.js'
import { businessMonth, todayStr, fmt0, monthLabel } from './lib/format.js'
import { splitServices, joinServices, serviceKey } from './lib/services.js'
import { TABLES, KIND_TABLE, PAY_FIELDS, COMPANY_FIELDS, MONTH_START_SETTING, LEAVE_TYPES, statusOf } from './lib/schema.js'
import { toAppt, overtimeValue } from './lib/appt.js'
import { clientKey } from './lib/stats.js'

export const METHODS = ['Cash', 'Card', 'EFT']
const MAX_HISTORY_DATA = 1_900_000 // a database row holds up to 2 MB
const CHUNK_ROWS = 1500 // records per request when many change at once

const db = {
  startDay: 1,
  employees: [], // { ...public, rec }
  services: [],
  appts: [],
  leave: [],
  payslips: [],
  clientInfo: [], // clients' cell numbers
  clientStats: null, // staff: her clients' visits at the salon as a whole { key: [visits, last] }
  clientDays: null, // staff: her clients' visit days at the salon { key: [dates…] }
  company: {},
  settings: {},
}

/* ---------------- talking to the Worker ---------------- */

class StaleError extends Error {}

/** Owner viewing the app as this team member (employee id), or ''. */
let viewAsId = ''
export const setViewAs = (id) => (viewAsId = id || '')

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken()
  if (!token) throw new AuthError('Please sign in with Google again.')
  let res
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(viewAsId ? { 'X-View-As': viewAsId } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('No connection to the salon\'s data. Check your internet and try again.')
  }
  if (res.status === 401) {
    clearSession()
    throw new AuthError('Your sign-in expired. Please sign in again.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.stale) throw new StaleError(data.error)
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  return data
}

/** Sends a change; very large ones go in several requests (history with the last). */
async function send(change) {
  const puts = Object.entries(change.put || {}).flatMap(([t, rows]) => rows.map((r) => [t, r]))
  if (puts.length <= CHUNK_ROWS) return request('/api/write', { method: 'POST', body: change })
  const { put, history, undone, ...first } = change
  for (let i = 0; i < puts.length; i += CHUNK_ROWS) {
    const part = {}
    for (const [t, r] of puts.slice(i, i + CHUNK_ROWS)) (part[t] ||= []).push(r)
    const last = i + CHUNK_ROWS >= puts.length
    await request('/api/write', { method: 'POST', body: { ...(i === 0 ? first : {}), put: part, ...(last ? { history, undone } : {}) } })
  }
}

/* ---------------- records ⇄ app objects ---------------- */

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim())
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2))
const parse = (s, fallback) => {
  if (s && typeof s === 'object') return s // already JSON (e.g. a payslip trimmed by the Worker)
  try { return s ? JSON.parse(s) : fallback } catch { return fallback }
}
const fromArray = (table, arr) => Object.fromEntries(TABLES[table].map((c, i) => [c, arr[i] ?? null]))

function apptRec(a, created, updated, by = user) {
  return {
    id: a.id, date: a.date, month: a.month, employee_id: a.employeeId, employee_name: a.employeeName, client: a.client,
    service: a.service, amount: a.writtenOff ?? a.amount, method: a.method, status: statusOf(a.status), paid_on: a.status === 'Paid' ? a.paidOn || '' : '', notes: a.notes || '',
    overtime: a.overtime === 'all' ? 'All' : a.overtime ? String(a.overtime) : '', length: a.overtime && a.length ? a.length : null,
    created_at: created, updated_at: updated, created_by: a.rec ? a.rec.created_by ?? null : by || null, updated_by: by || a.rec?.updated_by || null,
  }
}

function toEmployee(r) {
  const raw = parse(r.pay, {})
  const pay = {}
  for (const [key, , kind] of PAY_FIELDS) {
    const v = raw[key]
    pay[key] = kind === 'num' ? (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v)) : kind === 'bool' ? !!v : clean(v)
  }
  return { id: r.id, name: clean(r.name), phone: clean(r.phone), active: !!r.active, pay, rec: r }
}

/** Payslip details from the form, checked (numbers as numbers, blanks stay blank). */
function cleanPay(pay = {}, selfId = null) {
  const out = {}
  for (const [key, label, kind] of PAY_FIELDS) {
    const v = pay[key]
    if (kind === 'num') {
      if (v === '' || v == null) out[key] = ''
      else {
        const n = parseFloat(String(v).replace(',', '.'))
        if (!Number.isFinite(n) || n < 0) throw new Error(`Please check "${label}".`)
        out[key] = n
      }
    } else if (kind === 'date') {
      const d = clean(v)
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Please check "${label}".`)
      out[key] = d
    } else if (kind === 'bool') out[key] = !!v
    else out[key] = String(v ?? '').replace(/\r/g, '').trim()
  }
  if (/^[R\s]*[\d\s.,]+$/i.test(out.salaryLabel)) {
    const n = parseFloat(out.salaryLabel.replace(/[R\s,]/gi, ''))
    if (out.basic === '' && Number.isFinite(n)) out.basic = n
    out.salaryLabel = 'Basic Salary'
  }
  out.loginEmail = out.loginEmail.toLowerCase()
  if (out.loginEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.loginEmail)) throw new Error('Please check her Google email.')
  const taken = out.loginEmail && db.employees.find((e) => e.pay.loginEmail === out.loginEmail && e.id !== selfId)
  if (taken) throw new Error(`${out.loginEmail} is already ${taken.name}'s login.`)
  // A leave balance without a date is her balance today.
  if ((out.leaveOpening !== '' || out.sickUsed !== '') && !out.leaveFrom) out.leaveFrom = todayStr()
  return out
}

function toService(r) {
  const prices = parse(r.prices, {})
  return {
    id: r.id, name: clean(r.name), price: r.price === null || r.price === '' ? null : Number(r.price),
    prices: Object.fromEntries(Object.entries(prices).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])),
    active: r.active !== 0 && r.active !== false, rec: r,
  }
}
const cleanPrice = (v) => (v === '' || v == null ? '' : Math.round(parseFloat(String(v).replace(',', '.')) * 100) / 100)
function pricesJson(prices) {
  const out = {}
  for (const [k, v] of Object.entries(prices || {})) {
    const n = cleanPrice(v)
    if (n !== '' && n >= 0) out[k] = n
  }
  return Object.keys(out).length ? JSON.stringify(out) : ''
}

const toLeave = (r) => ({
  id: r.id, employeeId: clean(r.employee_id), employeeName: clean(r.employee_name), type: LEAVE_TYPES.includes(r.type) ? r.type : 'Annual',
  from: clean(r.from_date), to: clean(r.to_date) || clean(r.from_date), hours: Number(r.hours) || 0, notes: clean(r.notes),
  status: r.status || 'approved', requestedAt: clean(r.created_at), rec: r,
})
const toPayslip = (r) => ({
  id: r.id, employeeId: clean(r.employee_id), employeeName: clean(r.employee_name), month: clean(r.month), payDate: clean(r.pay_date),
  gross: Number(r.gross) || 0, paye: Number(r.paye) || 0, uif: Number(r.uif) || 0, deductions: Number(r.deductions) || 0,
  net: Number(r.net) || 0, details: parse(r.details, null), updatedAt: clean(r.updated_at), rec: r,
})

const toClientInfo = (r) => ({ id: r.id, name: clean(r.name), phone: clean(r.phone), rec: r })

const strip = ({ rec, ...x }) => x
const nameOf = (id) => db.employees.find((e) => e.id === id)?.name
const publicAppt = (a) => ({ ...strip(a), employeeName: nameOf(a.employeeId) || a.employeeName })
const publicEmployees = () => db.employees.map(strip).sort((a, b) => a.name.localeCompare(b.name))
const publicServices = () => db.services.map(strip).sort((a, b) => a.name.localeCompare(b.name))
const publicLeave = () => db.leave.map(strip).sort((a, b) => (a.from < b.from ? 1 : -1))
const publicPayslips = () => db.payslips.map(strip)

const LISTS = { appointments: 'appts', employees: 'employees', services: 'services', leave: 'leave', payslips: 'payslips', client_info: 'clientInfo' }
const MAKE = { appointments: toAppt, employees: toEmployee, services: toService, leave: toLeave, payslips: toPayslip, client_info: toClientInfo }
/** { clientKey: cell number } */
const clientPhones = () => Object.fromEntries(db.clientInfo.filter((c) => c.phone).map((c) => [c.id, c.phone]))

/** Updates the in-memory lists after a successful write. */
function applyLocal(put = {}, del = {}) {
  for (const [t, ids] of Object.entries(del)) {
    const gone = new Set(ids)
    db[LISTS[t]] = db[LISTS[t]].filter((x) => !gone.has(x.id))
  }
  for (const [t, recs] of Object.entries(put)) {
    const list = db[LISTS[t]]
    const index = new Map(list.map((x, i) => [x.id, i]))
    for (const r of recs) {
      const item = MAKE[t](r)
      if (index.has(r.id)) list[index.get(r.id)] = item
      else list.push(item)
    }
  }
}

/* ---------------- history (undo) ---------------- */

let user = ''
let lastEntry = null
export const setUser = (email) => (user = email || '')
export const lastEntryId = () => lastEntry

/**
 * Saves a change with its history entry. `before` = { appts: { id: recordOrNull }, … } — the records
 * as they were before (null = didn't exist yet). `expect` guards single edits against changes on another phone.
 */
async function commit(action, summary, { put = {}, del = {}, settings, before = {}, expect, undone, notify }) {
  let data = JSON.stringify(before)
  const tooBig = data.length > MAX_HISTORY_DATA
  if (tooBig) data = '{"tooBig":true}'
  const entry = { id: uuid(), time: new Date().toISOString(), who: user, action, summary: summary + (tooBig ? ' (too large to undo)' : ''), data }
  try {
    await send({ put, del, settings, expect, undone, notify, history: entry })
  } catch (err) {
    if (err instanceof StaleError) await load()
    throw err
  }
  applyLocal(put, del)
  lastEntry = entry.id
}

/** Current updated_at of records, to make sure nobody else changed them meanwhile. */
const expectOf = (table, items) => ({ [table]: Object.fromEntries(items.map((x) => [x.id, x.rec?.updated_at ?? null])) })

export async function getHistory() {
  const list = await request('/api/history')
  return list.map((e) => ({ id: e.id, time: e.time, who: e.who, action: e.action, summary: e.summary, undoneAt: e.undone_at || '' }))
}

/**
 * Undoes this change and everything after it: every record touched since then goes back to how it
 * was just before (the oldest stored state wins). The rollback is logged too, so it can be undone.
 */
export async function rollback(entryId) {
  await load()
  const recent = await request('/api/history')
  const since = recent.find((e) => e.id === entryId)?.time || '0'
  const all = await request('/api/history?since=' + encodeURIComponent(since))
  const target = all.find((e) => e.id === entryId)
  if (!target) throw new Error('That change was not found.')
  const span = all.filter((e) => e.time >= target.time).sort((a, b) => (a.time < b.time ? 1 : -1))
  const toUndo = span.filter((e) => !e.undone_at)
  if (!toUndo.length) throw new Error('That change has already been undone.')
  const wanted = Object.fromEntries(Object.keys(KIND_TABLE).map((k) => [k, {}]))
  for (const e of span) {
    const d = parse(e.data, { tooBig: true })
    if (d.tooBig) throw new Error(`"${e.summary}" was too large to undo automatically.`)
    for (const kind in wanted) Object.assign(wanted[kind], d[kind] || {})
  }
  const put = {}
  const del = {}
  const now = {}
  for (const [kind, table] of Object.entries(KIND_TABLE)) {
    const list = db[LISTS[table]]
    now[kind] = {}
    for (const [id, rec] of Object.entries(wanted[kind])) {
      now[kind][id] = list.find((x) => x.id === id)?.rec ?? null
      if (rec) (put[table] ||= []).push(rec)
      else (del[table] ||= []).push(id)
    }
  }
  const n = toUndo.length
  await commit('rollback', n === 1 ? `Undid: ${toUndo[0].summary}` : `Undid ${n} changes (back to before "${target.summary}")`,
    { put, del, before: now, undone: { ids: toUndo.map((e) => e.id), at: new Date().toISOString() } })
  await load()
  return n
}

/* ---------------- loading ---------------- */

async function load() {
  const data = await request('/api/load')
  db.employees = data.employees.map((a) => toEmployee(fromArray('employees', a)))
  db.services = data.services.map((a) => toService(fromArray('services', a)))
  db.appts = data.appointments.map((a) => toAppt(fromArray('appointments', a)))
  db.leave = data.leave.map((a) => toLeave(fromArray('leave', a)))
  db.payslips = data.payslips.map((a) => toPayslip(fromArray('payslips', a)))
  db.clientInfo = (data.client_info || []).map((a) => toClientInfo(fromArray('client_info', a)))
  db.clientStats = null
  db.clientDays = null
  db.settings = Object.fromEntries(data.settings.map(([k, v]) => [k, v ?? '']))
  const day = parseInt(db.settings[MONTH_START_SETTING], 10)
  db.startDay = day >= 1 && day <= 28 ? day : 1
  db.company = Object.fromEntries(COMPANY_FIELDS.map(([key, label]) => [key, String(db.settings[label] ?? '').trim()]))
}

/** Opens the salon's data (there's only one database, so the argument is ignored). */
export async function openSheet() {
  await load()
  return 'cloudflare'
}
export const reload = load
export async function createSheet() {
  return 'cloudflare'
}

export function getInitialData() {
  return {
    employees: publicEmployees(), services: publicServices(), spreadsheetUrl: '', monthStartDay: db.startDay,
    leave: publicLeave(), payslips: publicPayslips(), company: { ...db.company },
    clientPhones: clientPhones(), clientStats: db.clientStats, clientDays: db.clientDays,
  }
}

export function getAppointments(period) {
  return db.appts.filter((a) => a.month.startsWith(period)).map(publicAppt)
}

/** A tiny change probe: the newest data-change time on the server (one indexed row). */
export const dataRev = () => request('/api/rev')

/* ---------------- appointments ---------------- */

function validateAppointment(input) {
  const date = clean(input.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Please choose a valid date.')
  const employee = db.employees.find((e) => e.id === input.employeeId)
  if (!employee) throw new Error('Please choose an employee.')
  const amount = Math.round(parseFloat(String(input.amount).replace(',', '.')) * 100) / 100
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Please enter a valid amount.')
  if (!METHODS.includes(input.method)) throw new Error('Please choose Cash, Card or EFT.')
  return {
    date, employeeId: employee.id, employeeName: employee.name, client: clean(input.client), service: clean(input.service), amount,
    method: input.method, status: statusOf(input.status), notes: clean(input.notes),
    overtime: overtimeValue(input.overtime), length: Number(input.length) > 0 ? Math.round(Number(input.length)) : 0,
  }
}

export async function saveAppointment(input) {
  const v = validateAppointment(input)
  const now = new Date().toISOString()
  const existing = input.id ? db.appts.find((a) => a.id === input.id) : null
  if (input.id && !existing) throw new Error('This appointment was deleted on another phone.')
  const appt = {
    ...v,
    id: existing?.id || uuid(),
    month: existing && existing.date === v.date ? existing.month : businessMonth(v.date, db.startDay),
    paidOn: v.status === 'Paid' ? (existing?.status === 'Paid' && existing.paidOn) || todayStr() : '',
  }
  const label = `${appt.client || 'client'} · ${fmt0(appt.amount)} · ${appt.employeeName} · ${appt.date.slice(8)}/${appt.date.slice(5, 7)}`
  const rec = apptRec(appt, existing?.rec.created_at || now, now)
  await commit(existing ? 'edit' : 'add', `${existing ? 'Edited' : 'Added'} ${label}`, {
    put: { appointments: [rec] },
    before: { appts: { [appt.id]: existing ? existing.rec : null } },
    expect: existing ? expectOf('appointments', [existing]) : undefined,
  })
  return publicAppt(db.appts.find((a) => a.id === appt.id))
}

/** Changes several appointments at once; `change(a)` edits a copy. Returns the new public objects. */
async function changeAppts(items, change, action, summary, extra = null) {
  if (!items.length) return []
  const now = new Date().toISOString()
  const before = Object.fromEntries(items.map((a) => [a.id, a.rec]))
  const recs = items.map((a) => {
    const copy = { ...a }
    change(copy)
    return apptRec(copy, a.rec.created_at, now)
  })
  await commit(action, summary, {
    put: { appointments: recs, ...extra?.put }, del: extra?.del || {}, before: { appts: before, ...extra?.before },
    expect: items.length <= 50 ? expectOf('appointments', items) : undefined,
  })
  const ids = new Set(items.map((a) => a.id))
  return db.appts.filter((a) => ids.has(a.id)).map(publicAppt)
}

export async function updateAppointments(ids, changes = {}) {
  if (changes.method && !METHODS.includes(changes.method)) throw new Error('Invalid payment method.')
  const wanted = new Set(ids)
  const items = db.appts.filter((a) => wanted.has(a.id))
  const today = todayStr()
  const what = [changes.status && `marked ${changes.status.toLowerCase()}`, changes.method && `set to ${changes.method}`].filter(Boolean).join(' and ')
  const who = items.length === 1 ? `${items[0].client || 'Appointment'} (${fmt0(items[0].amount)})` : `${items.length} appointments`
  return changeAppts(items, (a) => {
    if (changes.method) a.method = changes.method
    if (changes.status) {
      if (changes.status === 'Paid' && a.status !== 'Paid') a.paidOn = today
      if (changes.status !== 'Paid') a.paidOn = ''
      a.status = statusOf(changes.status)
    }
  }, 'update', `${who} ${what}`)
}

export async function renameClients(ids, name, summary) {
  name = clean(name)
  if (!name) throw new Error('Please enter a name.')
  const wanted = new Set(ids)
  const items = db.appts.filter((a) => wanted.has(a.id))
  // Her cell number goes with her to the new name (unless the new name already has one).
  const to = clientKey(name)
  const from = [...new Set(items.map((a) => clientKey(a.client)))].filter((k) => k && k !== to)
  const moving = db.clientInfo.filter((c) => from.includes(c.id))
  const target = db.clientInfo.find((c) => c.id === to)
  const extra = { put: {}, del: {}, before: {} }
  if (moving.length) {
    const now = new Date().toISOString()
    const phone = target?.phone || moving.find((c) => c.phone)?.phone || ''
    extra.put.client_info = [{ id: to, name, phone, created_at: target?.rec.created_at || now, updated_at: now, updated_by: user || null }]
    extra.del.client_info = moving.map((c) => c.id)
    extra.before.cinfo = Object.fromEntries([[to, target?.rec || null], ...moving.map((c) => [c.id, c.rec])])
  }
  return changeAppts(items, (a) => (a.client = name), 'clients', summary || `Renamed client to ${name}`, extra)
}

/** A client's cell number (owner: any client; staff: her own clients, checked by the Worker). */
export async function saveClientPhone(client, phone) {
  const name = clean(client)
  const key = clientKey(name)
  if (!key) throw new Error('No client name.')
  const cell = String(phone || '').replace(/[^\d+ ]/g, '').trim()
  if (cell && cell.replace(/\D/g, '').length < 9) throw new Error('Please check the cell number.')
  const existing = db.clientInfo.find((c) => c.id === key)
  const now = new Date().toISOString()
  if (db.clientStats) {
    const rec = await request('/api/staff/client-phone', { method: 'POST', body: { client: name, phone: cell } })
    applyLocal({ client_info: [rec] })
  } else {
    const rec = { id: key, name, phone: cell, created_at: existing?.rec.created_at || now, updated_at: now, updated_by: user || null }
    await commit('clients', cell ? `Saved ${name}'s cell number` : `Removed ${name}'s cell number`, { put: { client_info: [rec] }, before: { cinfo: { [key]: existing?.rec || null } } })
  }
  return clientPhones()
}

export async function deleteAppointment(id) {
  const a = db.appts.find((x) => x.id === id)
  if (!a) return true
  await commit('delete', `Deleted ${a.client || 'client'} · ${fmt0(a.amount)} · ${a.date.slice(8)}/${a.date.slice(5, 7)}`, {
    del: { appointments: [id] }, before: { appts: { [id]: a.rec } },
  })
  return true
}

/* ---------------- team ---------------- */

export async function saveEmployee(input) {
  const name = clean(input?.name)
  if (!name) throw new Error('Please enter the employee\'s name.')
  const now = new Date().toISOString()
  const existing = input.id ? db.employees.find((e) => e.id === input.id) : null
  if (input.id && !existing) throw new Error('This team member was removed on another phone.')
  const pay = cleanPay(input.pay || existing?.pay, existing?.id)
  const rec = {
    id: existing?.id || uuid(), name, phone: clean(input.phone), active: existing ? (input.active !== false ? 1 : 0) : 1,
    pay: JSON.stringify(pay), created_at: existing?.rec.created_at || now, updated_at: now,
  }
  await commit('team', `${existing ? 'Updated' : 'Added'} team member ${name}`, {
    put: { employees: [rec] }, before: { emps: { [rec.id]: existing ? existing.rec : null } },
    expect: existing ? expectOf('employees', [existing]) : undefined,
  })
  return publicEmployees()
}

export async function deleteEmployee(id) {
  if (db.appts.some((a) => a.employeeId === id)) throw new Error('This employee has appointments. Mark her as inactive instead of deleting.')
  const emp = db.employees.find((e) => e.id === id)
  if (emp) await commit('team', `Removed team member ${emp.name}`, { del: { employees: [id] }, before: { emps: { [id]: emp.rec } } })
  return publicEmployees()
}

/* ---------------- services ---------------- */

const tidyName = (s) => clean(s).replace(/\s*\+\s*/g, ' & ')

/** Replaces service names inside appointments. Returns { put, before } for the changed ones. */
function renameInAppts(fromNames, toName, now) {
  const keys = new Set(fromNames.map(serviceKey))
  const renamed = (a) => joinServices(splitServices(a.service).map((t) => (keys.has(serviceKey(t)) ? toName : t)))
  const items = db.appts.filter((a) => renamed(a) !== a.service)
  return {
    put: items.map((a) => apptRec({ ...a, service: renamed(a) }, a.rec.created_at, now)),
    before: Object.fromEntries(items.map((a) => [a.id, a.rec])),
  }
}

const servicesResult = (apptIds) => ({
  services: publicServices(),
  appts: apptIds.map((id) => db.appts.find((a) => a.id === id)).filter(Boolean).map(publicAppt),
})

export async function saveService(input) {
  const name = tidyName(input?.name)
  if (!name) throw new Error('Please enter the service name.')
  const price = cleanPrice(input.price)
  if (price !== '' && !(price >= 0)) throw new Error('Please enter a valid price.')
  if (Object.values(input.prices || {}).some((v) => v !== '' && v != null && !(cleanPrice(v) >= 0))) throw new Error('Please enter valid prices.')
  const clash = db.services.find((x) => serviceKey(x.name) === serviceKey(name) && x.id !== input.id)
  if (clash) throw new Error(`There is already a service called "${clash.name}". Use Merge to combine them.`)
  const now = new Date().toISOString()
  const existing = input.id ? db.services.find((x) => x.id === input.id) : null
  const rec = {
    id: existing?.id || input.newId || uuid(), name, price: price === '' ? null : price, active: input.active !== false ? 1 : 0,
    prices: pricesJson(input.prices), created_at: existing?.rec.created_at || now, updated_at: now,
  }
  const from = existing ? (existing.name !== name ? [existing.name] : []) : input.fromNames || []
  const appts = from.length ? renameInAppts(from, name, now) : { put: [], before: {} }
  await commit('services', existing ? (existing.name !== name ? `Renamed service "${existing.name}" to "${name}"` : `Updated service ${name}`)
    : `Added service ${name}${price !== '' ? ' · ' + fmt0(price) : ''}`, {
    put: { services: [rec], appointments: appts.put },
    before: { svcs: { [rec.id]: existing ? existing.rec : null }, appts: appts.before },
  })
  return servicesResult(Object.keys(appts.before))
}

export async function mergeServices(fromNames, toName, summary) {
  toName = tidyName(toName)
  if (!toName) throw new Error('Please enter a name.')
  const now = new Date().toISOString()
  const keys = new Set([...fromNames, toName].map(serviceKey))
  const rows = db.services.filter((x) => keys.has(serviceKey(x.name)))
  const [keep, ...drop] = rows
  const put = { services: [] }
  const before = { svcs: {} }
  if (keep) {
    const price = keep.price ?? drop.find((d) => d.price != null)?.price ?? null
    put.services.push({
      ...keep.rec, name: toName, price, active: keep.active || drop.some((d) => d.active) ? 1 : 0,
      prices: pricesJson(Object.assign({}, ...[...drop].reverse().map((d) => d.prices), keep.prices)), updated_at: now,
    })
    before.svcs[keep.id] = keep.rec
  }
  for (const d of drop) before.svcs[d.id] = d.rec
  const appts = renameInAppts([...fromNames, toName], toName, now)
  put.appointments = appts.put
  before.appts = appts.before
  await commit('services', summary || `Merged services into "${toName}"`, { put, del: { services: drop.map((d) => d.id) }, before })
  return servicesResult(Object.keys(appts.before))
}

/* ---------------- leave & payslips ---------------- */

const ddmm = (d) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : '')

export async function saveLeave(input) {
  const emp = db.employees.find((e) => e.id === input.employeeId)
  if (!emp) throw new Error('Please choose who is taking leave.')
  const from = clean(input.from)
  const to = clean(input.to) || from
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new Error('Please choose valid dates.')
  const hours = Math.round(parseFloat(String(input.hours).replace(',', '.')) * 100) / 100
  if (!(hours > 0)) throw new Error('Please enter the hours of leave.')
  const type = LEAVE_TYPES.includes(input.type) ? input.type : 'Annual'
  const existing = input.id ? db.leave.find((l) => l.id === input.id) : null
  const now = new Date().toISOString()
  const rec = {
    id: existing?.id || uuid(), employee_id: emp.id, employee_name: emp.name, type, from_date: from, to_date: to, hours,
    notes: clean(input.notes), created_at: existing?.rec.created_at || now, updated_at: now,
    status: input.status || existing?.rec.status || null,
  }
  await commit('leave', `${existing ? 'Changed' : 'Booked'} ${type.toLowerCase()} leave · ${emp.name} · ${ddmm(from)}${to !== from ? '–' + ddmm(to) : ''} · ${hours} h`, {
    put: { leave: [rec] }, before: { leave: { [rec.id]: existing ? existing.rec : null } },
  })
  return publicLeave()
}

/** Approves or declines a staff member's leave request. */
export async function decideLeave(id, status) {
  const l = db.leave.find((x) => x.id === id)
  if (!l) throw new Error('That leave request was not found.')
  if (!['approved', 'declined'].includes(status)) throw new Error('Invalid decision.')
  const rec = { ...l.rec, status, updated_at: new Date().toISOString() }
  await commit('leave', `${status === 'approved' ? 'Approved' : 'Declined'} ${nameOf(l.employeeId) || l.employeeName}'s ${l.type.toLowerCase()} leave · ${ddmm(l.from)}${l.to !== l.from ? '–' + ddmm(l.to) : ''}`, {
    put: { leave: [rec] }, before: { leave: { [id]: l.rec } }, expect: expectOf('leave', [l]),
    notify: [{
      employeeId: l.employeeId, hash: 'leave', tag: `leave-${id}`,
      title: status === 'approved' ? '✅ Your leave was approved' : 'Your leave request was declined',
      body: `${l.type} · ${ddmm(l.from)}${l.to !== l.from ? '–' + ddmm(l.to) : ''} · ${l.hours} h`,
    }],
  })
  return publicLeave()
}

export async function deleteLeave(id) {
  const l = db.leave.find((x) => x.id === id)
  if (l) await commit('leave', `Removed ${l.type.toLowerCase()} leave · ${l.employeeName} · ${ddmm(l.from)}`, { del: { leave: [id] }, before: { leave: { [id]: l.rec } } })
  return publicLeave()
}

export async function savePayslip(slip) {
  const emp = db.employees.find((e) => e.id === slip.employeeId)
  if (!emp) throw new Error('Employee not found.')
  const existing = db.payslips.find((p) => p.employeeId === slip.employeeId && p.month === slip.month)
  const pick = (label) => slip.deductions.find((d) => d.label === label)?.amount || 0
  const other = slip.deductions.filter((d) => d.label !== 'PAYE' && d.label !== 'UIF').reduce((s, d) => s + d.amount, 0)
  const now = new Date().toISOString()
  const id = existing?.id || uuid()
  const rec = {
    id, employee_id: emp.id, employee_name: emp.name, month: slip.month, pay_date: slip.payDate, gross: slip.gross, paye: pick('PAYE'),
    uif: pick('UIF'), deductions: Math.round(other * 100) / 100, net: slip.net, details: JSON.stringify({ ...slip, id }),
    created_at: existing?.rec.created_at || now, updated_at: now,
  }
  await commit('pays', `${existing ? 'Updated' : 'Made'} payslip · ${emp.name} · ${slip.month} · net ${fmt0(slip.net)}`, {
    put: { payslips: [rec] }, before: { pays: { [id]: existing ? existing.rec : null } },
    // Only the first time (she may re-save it while checking the figures).
    notify: existing ? undefined : [{ employeeId: emp.id, hash: 'payslips', tag: `payslip-${id}`, title: `🧾 Your ${monthLabel(slip.month)} payslip is ready`, body: 'Open the app to view it or save it as a PDF.' }],
  })
  return { saved: strip(db.payslips.find((p) => p.id === id)), payslips: publicPayslips() }
}

export async function deletePayslip(id) {
  const p = db.payslips.find((x) => x.id === id)
  if (p) await commit('pays', `Deleted payslip · ${p.employeeName} · ${p.month}`, { del: { payslips: [id] }, before: { pays: { [id]: p.rec } } })
  return publicPayslips()
}

export async function saveCompany(company) {
  const settings = COMPANY_FIELDS.map(([key, label]) => [label, String(company[key] ?? '').replace(/\r/g, '').trim()])
  await send({ settings })
  for (const [label, value] of settings) db.settings[label] = value
  db.company = Object.fromEntries(COMPANY_FIELDS.map(([key, label]) => [key, db.settings[label]]))
  return { ...db.company }
}

/* ---------------- signed-in person, and staff (her own data only) ---------------- */

/** { role: 'admin' | 'staff', email, employeeId?, name? } */
export async function whoami() {
  await ensureSession()
  return request('/api/me')
}

/** Swaps a fresh Google sign-in for the app's own 60-day session (once, after signing in). */
/** An owner with a passcode signing in on this phone: ask for it (then call ensureSession(pin)). */
export class PinRequiredError extends Error {}

export async function ensureSession(pin = '') {
  if (FAKE_API || sessionToken()) return
  const google = googleToken()
  if (!google) throw new AuthError('Please sign in with Google again.')
  let res
  try {
    res = await fetch(API_URL + '/api/session', {
      method: 'POST', headers: { Authorization: 'Bearer ' + google, 'Content-Type': 'application/json' }, body: JSON.stringify(pin ? { pin } : {}),
    })
  } catch {
    throw new Error('No connection to the salon\'s data. Check your internet and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && data.pinRequired) throw new PinRequiredError(data.error)
  if (pin && [401, 403, 429].includes(res.status)) throw new Error(data.error || 'Wrong passcode.')
  if (res.status === 401) throw new AuthError(data.error || 'Please sign in with Google again.')
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`)
  saveSession(data)
}

/* ---------------- passcode (owners) ---------------- */

export const getPin = () => request('/api/pin')
export const verifyPin = (pin) => request('/api/pin/verify', { method: 'POST', body: { pin } })
export async function setPin(pin, current, signOutOthers) {
  const res = await request('/api/pin/set', { method: 'POST', body: { pin, current, signOutOthers } })
  if (res.session) saveSession(res.session)
  return res
}
export const removePin = (current) => request('/api/pin/remove', { method: 'POST', body: { current } })
export async function signOutOthers() {
  const res = await request('/api/pin/signout-others', { method: 'POST', body: {} })
  if (res.session) saveSession(res.session)
  return res
}

/** Staff: loads her own record, leave and payslips (the Worker only sends hers). */
export async function staffLoad() {
  const data = await request('/api/staff/load')
  db.employees = data.employees.map((a) => toEmployee(fromArray('employees', a)))
  db.services = []
  db.appts = data.appointments.map((a) => toAppt(fromArray('appointments', a)))
  db.leave = data.leave.map((a) => toLeave(fromArray('leave', a)))
  db.payslips = data.payslips.map((a) => toPayslip(fromArray('payslips', a)))
  db.clientInfo = (data.client_info || []).map((a) => toClientInfo(fromArray('client_info', a)))
  const days = data.client_days || []
  db.clientDays = Object.fromEntries(days)
  db.clientStats = Object.fromEntries(days.map(([k, dates]) => [k, [dates.length, dates[dates.length - 1]]]))
  db.settings = Object.fromEntries(data.settings.map(([k, v]) => [k, v ?? '']))
  const day = parseInt(db.settings[MONTH_START_SETTING], 10)
  db.startDay = day >= 1 && day <= 28 ? day : 1
  db.company = Object.fromEntries(COMPANY_FIELDS.map(([key, label]) => [key, String(db.settings[label] ?? '').trim()]))
  return getInitialData()
}

/** Staff: ask for leave, or change a request that's still waiting. */
export async function requestLeave(input) {
  const rec = await request('/api/staff/leave', { method: 'POST', body: input })
  applyLocal({ leave: [rec] })
  return publicLeave()
}

/** Staff: withdraw a request that's still waiting. */
export async function cancelLeave(id) {
  await request('/api/staff/leave/cancel', { method: 'POST', body: { id } })
  applyLocal({}, { leave: [id] })
  return publicLeave()
}

/** Staff: add or change one of her appointments. `amount` only when she typed one (she never sees it again). */
export async function saveMyAppointment(input) {
  const body = { ...input }
  if (body.amount === '' || body.amount == null) delete body.amount
  const rec = await request('/api/staff/appointment', { method: 'POST', body })
  applyLocal({ appointments: [rec] })
  return publicAppt(db.appts.find((a) => a.id === rec.id))
}

/** Staff: delete an appointment she added herself (within 24 hours). */
export async function deleteMyAppointment(id) {
  await request('/api/staff/appointment/delete', { method: 'POST', body: { id } })
  applyLocal({}, { appointments: [id] })
  return true
}

/** Owner: every change to one appointment (who, when, and how it was before). */
export async function appointmentHistory(id) {
  const list = await request('/api/history?record=' + encodeURIComponent(id))
  return list.map((e) => ({ ...e, before: typeof e.before === 'string' ? parse(e.before, null) : e.before }))
}

/** Staff: change her phone number and address. */
export async function updateMyDetails({ phone, address }) {
  const rec = await request('/api/staff/profile', { method: 'POST', body: { phone, address } })
  applyLocal({ employees: [rec] })
  return publicEmployees()
}

/* ---------------- moving the data in ---------------- */

/**
 * Replaces everything in the database with `data` (from the Google Sheet): employees, services,
 * appointments, leave, payslips (public objects with createdAt/updatedAt) and settings.
 * Returns what the database holds afterwards.
 */
export async function replaceAll(data, onProgress = () => {}) {
  const t = (x) => x.createdAt || new Date().toISOString()
  const u = (x) => x.updatedAt || x.createdAt || new Date().toISOString()
  const put = {
    employees: data.employees.map((e) => ({ id: e.id, name: e.name, phone: e.phone || '', active: e.active ? 1 : 0, pay: JSON.stringify(cleanPay(e.pay, e.id)), created_at: t(e), updated_at: u(e) })),
    services: data.services.map((s) => ({ id: s.id, name: s.name, price: s.price ?? null, active: s.active ? 1 : 0, prices: pricesJson(s.prices), created_at: t(s), updated_at: u(s) })),
    leave: data.leave.map((l) => ({ id: l.id, employee_id: l.employeeId, employee_name: l.employeeName, type: l.type, from_date: l.from, to_date: l.to, hours: l.hours, notes: l.notes || '', created_at: t(l), updated_at: u(l) })),
    payslips: data.payslips.map((p) => ({ id: p.id, employee_id: p.employeeId, employee_name: p.employeeName, month: p.month, pay_date: p.payDate, gross: p.gross, paye: p.paye, uif: p.uif, deductions: p.deductions, net: p.net, details: JSON.stringify(p.details), created_at: t(p), updated_at: u(p) })),
  }
  const settings = [[MONTH_START_SETTING, String(data.monthStartDay || 1)], ...COMPANY_FIELDS.map(([key, label]) => [label, data.company?.[key] || ''])]
  // First request empties the database (history too: undo starts fresh here) and adds the small
  // tables; then the appointments in parts.
  await request('/api/write', { method: 'POST', body: { replace: true, put, settings } })
  const appts = data.appts.map((a) => apptRec(a, t(a), u(a), null))
  for (let i = 0; i < appts.length; i += CHUNK_ROWS) {
    await request('/api/write', { method: 'POST', body: { put: { appointments: appts.slice(i, i + CHUNK_ROWS) } } })
    onProgress(Math.min(1, (i + CHUNK_ROWS) / appts.length))
  }
  await load()
  return summarize()
}

/** Counts and totals, to compare with the Google Sheet. */
export function summarize(src = db) {
  const appts = src.appts
  return {
    employees: src.employees.length,
    services: src.services.length,
    appointments: appts.length,
    total: Math.round(appts.reduce((s, a) => s + (Number(a.amount) || 0), 0) * 100) / 100,
    paid: appts.filter((a) => a.status === 'Paid').length,
    clients: new Set(appts.map((a) => clean(a.client).toLowerCase()).filter(Boolean)).size,
    leave: src.leave.length,
    payslips: src.payslips.length,
  }
}

/* ---------------- notifications ---------------- */

/** { emailOn, emailReady, vapidKey } for the signed-in person. */
export const getNotify = () => request('/api/notify')
export const setEmailNotify = (emailOn) => request('/api/notify/prefs', { method: 'POST', body: { emailOn } })
/** Owner: morning summary '' (off) | 'daily' | 'weekly'. */
export const setSummaryNotify = (summary) => request('/api/notify/prefs', { method: 'POST', body: { summary } })
export const addPushSubscription = (sub) => request('/api/notify/subscribe', { method: 'POST', body: sub })
export const removePushSubscription = (endpoint) => request('/api/notify/unsubscribe', { method: 'POST', body: { endpoint } })
export const testNotify = () => request('/api/notify/test', { method: 'POST', body: {} })
/* The salon's Gmail (sends the app's emails) — owners. */
export const getGoogleStatus = () => request('/api/google/status')
export const googleConnectUrl = () => request('/api/google/connect')
export const disconnectGoogle = () => request('/api/google/disconnect', { method: 'POST', body: {} })

/** Owner: the Gmail relay (Apps Script) link and the script to paste. */
export const getEmailRelay = () => request('/api/notify/email')
export const setEmailRelay = (url) => request('/api/notify/email', { method: 'POST', body: { url } })
