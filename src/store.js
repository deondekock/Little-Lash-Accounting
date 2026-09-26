import { reactive, computed, shallowRef, nextTick } from 'vue'
import { call } from './api.js'
import { currentMonth, todayStr, monthLabel } from './lib/format.js'
import { buildClients, buildServices, clientFlow } from './lib/stats.js'
import { CLIENT_ID, DEFAULT_SHEET_ID, FAKE_API } from './config.js'
import * as auth from './google/auth.js'
import { AuthError } from './google/sheets.js'
import * as backend from './backend.js'

const SHEET_KEY = 'llp.sheetId'
function savedSheetId(value) {
  try {
    if (value === undefined) return localStorage.getItem(SHEET_KEY)
    if (value === null) localStorage.removeItem(SHEET_KEY)
    else localStorage.setItem(SHEET_KEY, value)
  } catch {
    return null
  }
}

export const state = reactive({
  // 'loading' | 'config' (no Google client ID) | 'signedOut' | 'pickSheet' | 'ready' | 'error'
  phase: 'loading',
  email: '',
  loadedAt: 0,
  pending: 0,
  view: 'home', // 'home' | 'payments' | 'clients' | 'team' | 'insights' | 'services' | 'payroll'
  payrollTab: 'payslips', // Payroll view: 'payslips' | 'leave'
  employees: [],
  leave: [], // booked leave (Leave tab)
  payslips: [], // saved payslips (Payslips tab)
  company: {}, // company details for payslips (Settings tab)
  services: [], // her service list (Services tab)
  spreadsheetUrl: '',
  monthStartDay: 1, // from the sheet's Settings tab; 26 → "July" = 26 Jun – 25 Jul
  month: currentMonth(),
  year: new Date().getFullYear(),
  employee: 'all', // employee filter: 'all' or an employee id
  status: 'all', // 'all' | 'Paid' | 'Unpaid'
  selected: new Set(),
  modal: null, // { type: 'appointment' | 'employee' | 'client' | 'settings', data }
  clientFilter: 'all', // Clients view: 'all' | 'regulars' | 'due' | 'new'
  toast: null, // { msg, error, action }
  history: null, // History entries (loaded when the History sheet opens)
  printing: null, // payslips being printed / saved as PDF
})

/**
 * Every appointment in the sheet (all years). Kept as a plain array (not deeply
 * reactive) and replaced on every change — fast even with 16k+ rows.
 */
export const all = shallowRef([])

export const employeeById = (id) => state.employees.find((e) => e.id === id)

/** Chart colour slot (1–6) per employee: active staff first, so today's team gets the first colours. */
export const employeeSlot = computed(() => {
  const order = [...state.employees].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))
  return Object.fromEntries(order.map((e, i) => [e.id, i < 6 ? i + 1 : 0]))
})
export const employeeColor = (id) => {
  const slot = employeeSlot.value[id]
  return slot ? `var(--series-${slot})` : 'var(--series-other)'
}

/** One entry per client (visits, spend, history…) — shared by Home, Clients and the forms. */
export const clients = computed(() => buildClients(all.value))

/** Every service (her list + names used on past appointments) with usage stats. */
export const serviceCatalog = computed(() => buildServices(all.value, state.services))

/** New / returning / regular clients and switches per team member for the selected month. */
export const monthFlow = computed(() => clientFlow(all.value, state.month))
export const openFlow = (employeeId, category) => (state.modal = { type: 'flow', data: { employeeId, category } })

/** Appointments in the selected business month. */
export const monthAppts = computed(() => all.value.filter((a) => a.month === state.month))

/** Appointments in the selected year (by business month). */
export const yearAppts = computed(() => {
  const y = String(state.year)
  return all.value.filter((a) => a.month.startsWith(y))
})

/** Month appointments for the selected employee (ignores the status filter). */
export const employeeAppts = computed(() =>
  state.employee === 'all' ? monthAppts.value : monthAppts.value.filter((a) => a.employeeId === state.employee),
)

/** Month appointments for the selected employee and status. */
export const visibleAppts = computed(() =>
  state.status === 'all' ? employeeAppts.value : employeeAppts.value.filter((a) => a.status === state.status),
)

/* ---------------- feedback ---------------- */

let toastTimer
export function toast(msg, error = false, action = null) {
  state.toast = { msg, error, action }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (state.toast = null), error ? 5000 : action ? 6000 : 2200)
}

/** A confirmation with an "Undo" button that rolls back the change just made. */
export function toastUndo(msg) {
  const id = backend.lastEntryId()
  toast(msg, false, id ? { label: 'Undo', run: () => rollbackTo(id) } : null)
}

export function fail(err) {
  if (err instanceof AuthError) state.phase = 'signedOut'
  toast(String(err?.message || err), true)
}

async function api(fn, ...args) {
  state.pending++
  try {
    return await call(fn, ...args)
  } finally {
    state.pending--
  }
}

/* ---------------- loading ---------------- */

export async function init() {
  const redirect = auth.handleRedirect()
  if (!CLIENT_ID && !FAKE_API) {
    state.phase = 'config'
    return
  }
  if (!auth.getToken()) {
    // Token expired: quietly get a new one if she has signed in before (no screen shown).
    if (!redirect?.error && auth.canTrySilent()) return auth.signIn({ silent: true })
    state.phase = 'signedOut'
    return
  }
  state.email = auth.knownEmail()
  backend.setUser(state.email)
  if (!state.email) auth.fetchEmail().then((e) => { state.email = e; backend.setUser(e) }).catch(() => {})
  const id = savedSheetId() || DEFAULT_SHEET_ID
  if (!id) {
    state.phase = 'pickSheet'
    return
  }
  await openSheet(id)
}

export const signIn = () => auth.signIn()

export function signOut() {
  auth.signOut()
  state.phase = 'signedOut'
  state.email = ''
}

/** Opens (and remembers) a sheet by link or ID. */
export async function openSheet(idOrUrl) {
  state.phase = state.phase === 'pickSheet' ? 'pickSheet' : 'loading'
  try {
    const id = await api('openSheet', idOrUrl)
    savedSheetId(id)
    const data = await api('getInitialData')
    applyData(data)
    state.spreadsheetUrl = data.spreadsheetUrl
    state.month = currentMonth(state.monthStartDay)
    state.year = Number(state.month.slice(0, 4))
    await loadAll()
    state.loadedAt = Date.now()
    state.phase = 'ready'
    return true
  } catch (err) {
    if (!(err instanceof AuthError)) state.phase = savedSheetId() ? 'error' : 'pickSheet'
    fail(err)
    return false
  }
}

export async function createSheet() {
  try {
    const id = await api('createSheet')
    return openSheet(id)
  } catch (err) {
    fail(err)
    return false
  }
}

export function useDifferentSheet() {
  savedSheetId(null)
  state.phase = 'pickSheet'
}

/** Re-reads the sheet (e.g. after changes made on another phone). */
export async function refresh() {
  try {
    await api('reload')
    applyData(await api('getInitialData'))
    await loadAll()
    state.loadedAt = Date.now()
    toast('Up to date')
  } catch (err) {
    fail(err)
  }
}

function applyData(data) {
  state.employees = data.employees
  state.services = data.services || []
  state.monthStartDay = data.monthStartDay || 1
  state.leave = data.leave || []
  state.payslips = data.payslips || []
  state.company = data.company || {}
}

async function loadAll() {
  all.value = await api('getAppointments', '')
  state.selected.clear()
}

export function changeMonth(month) {
  state.month = month
  state.selected.clear()
}

export function changeYear(delta) {
  state.year += delta
}

export function setYear(year) {
  state.year = year
}

export function setView(view, opts = {}) {
  state.view = view
  if (opts.employee) state.employee = opts.employee
  if (opts.status) state.status = opts.status
  if (opts.month) state.month = opts.month
  if (opts.clientFilter) state.clientFilter = opts.clientFilter
  if (opts.payrollTab) state.payrollTab = opts.payrollTab
  if (view === 'insights') state.year = Number(state.month.slice(0, 4))
  state.selected.clear()
  window.scrollTo({ top: 0 })
}

export function setEmployee(id) {
  state.employee = id
  state.selected.clear()
}

export function setStatus(status) {
  state.status = status
  state.selected.clear()
}

/* ---------------- appointments ---------------- */

function upsertAppts(list) {
  const byId = new Map(list.map((x) => [x.id, x]))
  const next = all.value.map((a) => byId.get(a.id) || a)
  for (const x of list) if (!all.value.some((a) => a.id === x.id)) next.push(x)
  all.value = next
}

export async function saveAppointment(data) {
  const saved = await api('saveAppointment', data)
  upsertAppts([saved])
  if (saved.month !== state.month) changeMonth(saved.month)
  return saved
}

export async function deleteAppointment(id) {
  await api('deleteAppointment', id)
  all.value = all.value.filter((x) => x.id !== id)
  state.selected.delete(id)
}

/** Changes status and/or method on several appointments. Optimistic, so taps feel instant. */
export async function updateMany(ids, changes) {
  const before = all.value
  const wanted = new Set(ids)
  const today = todayStr()
  all.value = all.value.map((a) => {
    if (!wanted.has(a.id)) return a
    const next = { ...a }
    if (changes.method) next.method = changes.method
    if (changes.status) {
      if (changes.status === 'Paid' && a.status !== 'Paid') next.paidOn = today
      if (changes.status === 'Unpaid') next.paidOn = ''
      next.status = changes.status
    }
    return next
  })
  try {
    upsertAppts(await api('updateAppointments', ids, changes))
    return true
  } catch (err) {
    all.value = before
    fail(err)
    return false
  }
}

/** Rename one client, or merge several spellings/clients into one name. */
export async function renameClients(ids, name, summary) {
  upsertAppts(await api('renameClients', ids, name, summary))
}

/* ---------------- services ---------------- */

export async function saveService(input) {
  const res = await api('saveService', input)
  state.services = res.services
  if (res.appts.length) upsertAppts(res.appts)
}

export async function mergeServices(fromNames, toName, summary) {
  const res = await api('mergeServices', fromNames, toName, summary)
  state.services = res.services
  if (res.appts.length) upsertAppts(res.appts)
}

/** Puts every past service on her list, linked to whoever did it at her usual price. */
export async function importPastServices() {
  const items = serviceCatalog.value
    .filter((s) => !s.inList)
    .map((s) => ({ name: s.name, prices: { ...s.typicalBy } }))
  const res = await api('importServices', items)
  state.services = res.services
  return res.added
}

export const openService = (service) => (state.modal = { type: 'service', data: service ? { ...service } : null })
export const openServiceMerge = (service, opts = {}) => (state.modal = { type: 'serviceMerge', data: { service, with: opts.with || [] } })

/* ---------------- history & undo ---------------- */

export async function loadHistory() {
  state.history = null
  try {
    state.history = await api('getHistory')
  } catch (err) {
    state.history = []
    fail(err)
  }
}

/** Undo this change and everything after it. */
export async function rollbackTo(entryId) {
  try {
    const n = await api('rollback', entryId)
    applyData(await api('getInitialData'))
    await loadAll()
    if (state.modal?.type === 'history') await loadHistory()
    toastUndo(n === 1 ? 'Undone' : `Undid ${n} changes`)
    return true
  } catch (err) {
    fail(err)
    return false
  }
}

/* ---------------- employees ---------------- */

export async function saveEmployee(payload) {
  state.employees = await api('saveEmployee', payload)
  if (payload.id) {
    const name = payload.name.trim()
    all.value = all.value.map((a) => (a.employeeId === payload.id ? { ...a, employeeName: name } : a))
  }
}

export async function deleteEmployee(id) {
  state.employees = await api('deleteEmployee', id)
  if (state.employee === id) state.employee = 'all'
}

/* ---------------- payroll & leave ---------------- */

export async function saveLeave(input) {
  state.leave = await api('saveLeave', input)
}

export async function deleteLeave(id) {
  state.leave = await api('deleteLeave', id)
}

export async function savePayslip(slip) {
  const res = await api('savePayslip', slip)
  state.payslips = res.payslips
  return res.saved
}

export async function deletePayslip(id) {
  state.payslips = await api('deletePayslip', id)
}

export async function saveCompany(company) {
  state.company = await api('saveCompany', company)
}

export const openLeave = (leave, prefill = null) => (state.modal = { type: 'leave', data: leave ? { ...leave } : null, prefill })
export const openPayslip = (employeeId) => (state.modal = { type: 'payslip', data: { employeeId } })
export const openCompany = () => (state.modal = { type: 'company', data: null })
export const openImportPayslips = () => (state.modal = { type: 'importPayslips', data: null })
export const readOldPayslips = (link) => api('readOldPayslips', link)

/** Prints payslips (the phone's print screen also saves them as a PDF). */
export async function printPayslips(slips) {
  const title = document.title
  const first = slips[0]
  document.title = slips.length === 1 ? `Payslip ${first.name} ${monthLabel(first.month)}` : `Payslips ${monthLabel(first.month)}`
  state.printing = slips
  await nextTick()
  const done = () => {
    state.printing = null
    document.title = title
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

/* ---------------- modals ---------------- */

/** Opens the appointment form: `appt` to edit, or `prefill` values for a new one. */
export const openAppointment = (appt, prefill = null) =>
  (state.modal = { type: 'appointment', data: appt ? { ...appt } : null, prefill })
export const openEmployee = (emp) => (state.modal = { type: 'employee', data: emp ? { ...emp } : null })
export const openClient = (client) => (state.modal = { type: 'client', data: client })
export const openSettings = () => (state.modal = { type: 'settings', data: null })
export const openHistory = () => {
  state.modal = { type: 'history', data: null }
  loadHistory()
}
export const openMerge = (client, opts = {}) => (state.modal = { type: 'merge', data: { client, with: opts.with || [], mode: opts.mode || 'merge' } })
/** Month/year picker sheet. mode 'month' sets state.month; 'year' sets state.year (Insights). */
export const openPicker = (mode = 'month') => (state.modal = { type: 'picker', data: { mode } })
export const closeModal = () => (state.modal = null)
