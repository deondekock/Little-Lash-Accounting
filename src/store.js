import { reactive, computed, shallowRef, nextTick, watch } from 'vue'
import { newVersionAvailable, updateApp } from './lib/update.js'
import { shouldLock, markSeen, rememberPinSet } from './lib/lock.js'
import { PinRequiredError } from './backend-cf.js'
import { call, backend } from './api.js'
import { currentMonth, todayStr, monthLabel } from './lib/format.js'
import { buildClients, buildServices, clientFlow, followUp, nextMilestone, daysBetween, clientKey } from './lib/stats.js'
import { salonDays } from './lib/rebook.js'
import { isIos } from './lib/push.js'
import { clearLoadCache } from './lib/loadcache.js'
import { CLIENT_ID, DEFAULT_SHEET_ID, FAKE_API, BACKEND } from './config.js'
import * as auth from './google/auth.js'
import { AuthError } from './google/sheets.js'

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
  // 'loading' | 'config' (no Google client ID) | 'signedOut' | 'pin' (owner's passcode to sign in) | 'pickSheet' | 'ready' | 'error'
  phase: 'loading',
  locked: false, // the app lock is showing (owner's passcode needed again)
  pinSet: false, // the signed-in owner has a passcode
  email: '',
  loadedAt: 0,
  updating: false, // a background refresh is running after an instant cache-first start
  pending: 0,
  view: 'home', // 'home' | 'payments' | 'clients' | 'team' | 'insights' | 'services' | 'payroll' (staff: 'my-leave' | 'my-payslips' | 'my-details')
  role: 'admin', // 'admin' (owner: everything) | 'staff' (her own leave, payslips and details)
  me: null, // staff: { employeeId, name, email }
  viewAs: null, // owner viewing the app as a team member: { id, name }
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
  status: 'all', // 'all' | 'Paid' | 'Unpaid' | 'Written off'
  selected: new Set(),
  modal: null, // { type: 'appointment' | 'employee' | 'client' | 'settings', data }
  clientFilter: 'all', // Clients view: 'all' | 'regulars' | 'due' | 'new'
  toast: null, // { msg, error, action }
  error: '', // why the data couldn't be opened
  history: null, // History entries (loaded when the History sheet opens)
  printing: null, // payslips being printed / saved as PDF
  printingReport: null, // a report being printed / saved as PDF
  clientPhones: {}, // { clientKey: cell number }
  clientQuiet: {}, // { clientKey: reason } — clients dismissed from the win-back list
  vouchers: [], // gift vouchers sold (with remaining balance)
  clientStats: null, // staff: her clients' visits at the whole salon { key: [visits, last] }
  clientDays: null, // staff: her clients' visit days at the whole salon { key: [dates…] }
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

/**
 * One entry per client (visits, spend, history…) — shared by Home, Clients and the forms.
 * Staff only have their own appointments, so visits, "due", "gone quiet" and milestones use the
 * salon-wide counts the Worker sends (a client who saw someone else last week isn't "due").
 */
export const clients = computed(() => {
  const list = buildClients(all.value)
  const stats = state.clientStats
  const quiet = state.clientQuiet
  const withStats = !stats ? list : (() => {
    const today = todayStr()
    return list.map((c) => {
      const s = stats[c.key]
      if (!s) return c
      const [visits, last] = s
      const since = daysBetween(last, today)
      const status = followUp(visits, c.usualGap, since)
      return { ...c, salonVisits: visits, salonLast: last, due: status === 'due', quiet: status === 'quiet', milestone: nextMilestone(visits) }
    })
  })()
  // A client dismissed from win-back drops off the "gone quiet" list (the note says why).
  return withStats.map((c) => {
    const note = quiet[c.key]
    if (note === undefined) return c
    return { ...c, dismissedQuiet: true, quietNote: note, quiet: false }
  })
})

/** Who WhatsApp messages are signed by: the team member herself, or the owner. */
export const senderName = computed(() => {
  if (state.role === 'staff') return (state.me?.name || '').split(' ')[0]
  return (state.employees.find((e) => e.pay?.owner)?.name || '').split(' ')[0]
})

/** Every client's visit days at the salon (for rebooking rates). Staff get theirs from the Worker. */
export const visitDays = computed(() => (state.clientDays ? new Map(Object.entries(state.clientDays)) : salonDays(all.value)))

/** A client's cell number, if saved. */
export const phoneOf = (c) => state.clientPhones[c?.key] || ''
export async function saveClientPhone(client, phone) {
  state.clientPhones = await api('saveClientPhone', client, phone)
}

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
  try { navigator.storage?.persist?.() } catch { /* keep the on-device cache from being evicted */ }
  if (shouldLock()) state.locked = true // before anything shows
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
  if (!state.email && BACKEND !== 'cloudflare') auth.fetchEmail().then((e) => { state.email = e; backend.setUser(e) }).catch(() => {})
  if (BACKEND === 'cloudflare') {
    try {
      const me = await api('whoami')
      state.email = me.email
      backend.setUser(me.email)
      auth.rememberEmail(me.email)
      state.role = me.role
      if (me.role === 'staff') {
        state.me = me
        state.view = 'my-appointments'
        return await openStaff()
      }
    } catch (err) {
      if (err instanceof PinRequiredError) {
        state.locked = false
        state.phase = 'pin'
        return
      }
      state.error = String(err?.message || err)
      if (!(err instanceof AuthError)) state.phase = 'error'
      fail(err)
      return
    }
    await openSheet('cloudflare')
    if (state.role === 'admin') {
      refreshPin()
    }
    return
  }
  const id = savedSheetId() || DEFAULT_SHEET_ID
  if (!id) {
    state.phase = 'pickSheet'
    return
  }
  await openSheet(id)
}

export const signIn = () => auth.signIn()

/* ---------------- owner's passcode ---------------- */

/** Signing in on a new phone: Google, then her passcode. */
export async function signInWithPin(pin) {
  await api('ensureSession', pin)
  markSeen()
  state.locked = false
  state.phase = 'loading'
  await init()
}
/** The app lock: her passcode again (checked by the Worker, so guesses are limited). */
export async function unlock(pin) {
  await api('verifyPin', pin)
  markSeen()
  state.locked = false
}
export async function refreshPin() {
  try {
    const r = await api('getPin')
    state.pinSet = !!r.set
    rememberPinSet(r.set)
  } catch { /* keep what we knew */ }
}
export const openSecurity = () => (state.modal = { type: 'security', data: null })

export function signOut() {
  state.locked = false
  auth.signOut()
  clearLoadCache() // forget the cached data copy on this device
  state.phase = 'signedOut'
  state.email = ''
}

/** Opens (and remembers) a sheet by link or ID. */
export async function openSheet(idOrUrl) {
  state.phase = state.phase === 'pickSheet' ? 'pickSheet' : 'loading'
  try {
    // Cloudflare: open instantly from the on-device copy, or just this month, then fill in behind the UI.
    let mode = 'full'
    if (BACKEND === 'cloudflare') {
      const res = await api('openFast', recentFrom())
      mode = res?.mode || 'full'
      lastRev = res?.rev ?? null
    } else {
      savedSheetId(await api('openSheet', idOrUrl))
    }
    const data = await api('getInitialData')
    applyData(data)
    state.spreadsheetUrl = data.spreadsheetUrl
    state.month = currentMonth(state.monthStartDay)
    state.year = Number(state.month.slice(0, 4))
    all.value = await api('getAppointments', '')
    state.selected.clear()
    if (BACKEND !== 'cloudflare') await markRev()
    state.loadedAt = Date.now()
    // Owner lands on today's Payments page (unless a deep link says otherwise).
    if (BACKEND === 'cloudflare' && state.role !== 'staff' && !location.hash) state.view = 'payments'
    state.phase = 'ready'
    openHash(location.hash)
    if (mode === 'cache') backgroundRefresh() // rendered a full stored copy — make sure it's current
    else if (mode === 'instant' || mode === 'light') backgroundFull() // rendered the recent slice — pull the full history in
    return true
  } catch (err) {
    state.error = String(err?.message || err)
    if (!(err instanceof AuthError)) state.phase = BACKEND === 'cloudflare' || savedSheetId() ? 'error' : 'pickSheet'
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
/** Opens the page a notification points to (#leave, #payslips, #team). */
export function openHash(hash) {
  if (state.phase === 'ready') markFirstPage()
  const h = String(hash || '').replace(/^#/, '')
  if (!h || state.phase !== 'ready') return
  // #add, #owed and #due come from the app icon's long-press shortcuts (manifest).
  if (state.role === 'staff') {
    if (h === 'leave') setView('my-leave')
    if (h === 'payslips') setView('my-payslips')
    if (h === 'clients') setView('my-clients')
    if (h === 'due') setView('my-clients', { clientFilter: 'due' })
    if (h === 'owed') setView('my-appointments')
    if (h === 'add') {
      setView('my-appointments')
      openMyAppointment(null, { date: todayStr() })
    }
  } else {
    if (h === 'leave' || h === 'payslips') setView('payroll', { payrollTab: h })
    if (h === 'team') setView('team')
    if (h === 'clients') setView('clients')
    if (h === 'due') setView('clients', { clientFilter: 'due' })
    if (h === 'owed') setView('clients', { clientFilter: 'owing' })
    if (h === 'add') openAppointment()
    // Back from Google after connecting the salon's Gmail.
    if (h.startsWith('gmail-')) {
      const msg = { 'gmail-connected': 'Gmail connected 🎉', 'gmail-cancelled': 'Gmail not connected (cancelled)', 'gmail-expired': 'That took too long — please try again', 'gmail-failed': "Google didn't allow it — please try again" }[h]
      if (msg) toast(msg, h !== 'gmail-connected')
      openGmail()
    }
  }
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
}
// A shortcut used while the app is already open only changes the #.
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => openHash(location.hash))
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open') refresh().then(() => openHash(e.data.hash))
  })
}

/** Owner: see the app exactly as this team member does (her data, her rules). */
export async function viewAs(emp) {
  backend.setViewAs(emp.id)
  state.modal = null
  state.viewAs = { id: emp.id, name: emp.name }
  state.role = 'staff'
  state.view = 'my-appointments'
  state.phase = 'loading'
  try {
    state.me = await api('whoami')
  } catch (err) {
    return exitViewAs().then(() => fail(err))
  }
  await openStaff()
  window.scrollTo({ top: 0 })
}

/** Owner: back to her own view. */
export async function exitViewAs() {
  backend.setViewAs('')
  state.modal = null
  state.viewAs = null
  state.role = 'admin'
  state.me = null
  state.view = 'team'
  await openSheet('cloudflare')
  window.scrollTo({ top: 0 })
}
export const openViewAsPicker = () => (state.modal = { type: 'viewAs', data: null })
export const openPayslipView = (slip) => (state.modal = { type: 'payslipView', data: slip })

/** Staff: her own data only. */
async function openStaff() {
  try {
    applyData(await api('staffLoad'))
    await loadAll()
    state.month = currentMonth(state.monthStartDay)
    state.loadedAt = Date.now()
    state.phase = 'ready'
    openHash(location.hash)
  } catch (err) {
    state.error = String(err?.message || err)
    if (!(err instanceof AuthError)) state.phase = 'error'
    fail(err)
  }
}

export async function requestLeave(input) {
  state.leave = await api('requestLeave', input)
}
export async function cancelLeave(id) {
  state.leave = await api('cancelLeave', id)
}
export async function decideLeave(id, status) {
  state.leave = await api('decideLeave', id, status)
}
export async function saveMyAppointment(input) {
  const saved = await api('saveMyAppointment', input)
  upsertAppts([saved])
  return saved
}
export async function deleteMyAppointment(id) {
  await api('deleteMyAppointment', id)
  all.value = all.value.filter((a) => a.id !== id)
}
export const openMyAppointment = (appt, prefill = null) => (state.modal = { type: 'myAppointment', data: appt ? { ...appt } : null, prefill })

export async function updateMyDetails(details) {
  state.employees = await api('updateMyDetails', details)
}

export async function refresh() {
  // A newer version of the app itself (new look, fixes): load that instead.
  if (await newVersionAvailable()) {
    toast('Updating the app…')
    return updateApp()
  }
  if (state.role === 'staff') {
    await openStaff()
    if (state.phase === 'ready') toast('Up to date')
    return
  }
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
  state.clientPhones = data.clientPhones || {}
  state.clientQuiet = data.clientQuiet || {}
  state.vouchers = data.vouchers || []
  state.clientStats = data.clientStats || null
  state.clientDays = data.clientDays || null
}

// The newest data change we've loaded (from /api/rev). Used to skip full reloads when nothing changed.
let lastRev = null
async function markRev() {
  try { lastRev = (await call('dataRev')).rev } catch { lastRev = null }
}

async function loadAll() {
  all.value = await api('getAppointments', '')
  state.selected.clear()
  await markRev()
}

/** The business-month cutoff for the quick first load: just this month (today's work). The rest follows. */
function recentFrom() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** After a recent-only first paint, pull the full history in the background so Clients/Insights fill in. */
async function backgroundFull() {
  try {
    state.updating = true
    await api('loadFull', recentFrom())
    applyData(await api('getInitialData'))
    all.value = await api('getAppointments', '')
    state.selected.clear()
    lastRev = await api('currentRev')
    state.loadedAt = Date.now()
  } catch { /* keep the recent view; maybeRefresh will retry later */ } finally {
    state.updating = false
  }
}

/** After an instant cache-first start, quietly pull a fresh copy if the server has moved on. */
async function backgroundRefresh() {
  if (BACKEND !== 'cloudflare') return
  try {
    state.updating = true
    if (await api('revalidate')) {
      const data = await api('getInitialData')
      applyData(data)
      state.spreadsheetUrl = data.spreadsheetUrl
      all.value = await api('getAppointments', '')
      state.selected.clear()
      state.loadedAt = Date.now()
    }
    lastRev = await api('currentRev')
  } catch { /* offline/transient — maybeRefresh reconciles later */ } finally {
    state.updating = false
  }
}

/**
 * Coming back to the app: ask the server (one tiny indexed row) whether anything changed, and only do a
 * full reload when it has. Keeps the data fresh across devices without re-reading the whole database each
 * time the tab regains focus.
 */
export async function maybeRefresh() {
  if (state.phase !== 'ready' || state.modal) return
  try {
    const { rev } = await call('dataRev')
    if (lastRev !== null && rev === lastRev) {
      state.loadedAt = Date.now()
      return
    }
  } catch {
    // Probe failed — fall through to a normal refresh, which surfaces any real error.
  }
  await refresh()
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
  if (view !== state.view) rememberPage(view)
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
  if (data.tenders?.some?.((t) => t.method === 'Voucher')) state.vouchers = await api('currentVouchers')
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
      if (changes.status !== 'Paid') next.paidOn = ''
      // Written off counts as R0 (the amount is kept aside), and back again.
      if (changes.status === 'Written off' && a.status !== 'Written off') Object.assign(next, { writtenOff: a.amount, amount: 0 })
      if (changes.status !== 'Written off' && a.status === 'Written off') { next.amount = a.writtenOff || 0; delete next.writtenOff }
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
export const openNotifications = () => (state.modal = { type: 'notifications', data: null })
export const openMyLeave = (leave) => (state.modal = { type: 'myLeave', data: leave ? { ...leave } : null })
export const openMove = () => (state.modal = { type: 'move', data: null })
export const openExport = () => (state.modal = { type: 'export', data: null })

/**
 * Printing / save-as-PDF. On a computer or Android, window.print() prints the hidden .print-root (the
 * rest of the page is hidden by @media print). On iPhone that silently fails — worse, calling it after
 * an await loses the tap, so nothing happens — so there we open the document in a new Safari tab where
 * Print / Save to PDF / Save to Files work. The tab must be opened *inside the tap* (before any await),
 * so callers open it first with openPrintWindow() and hand it in.
 */
export const openPrintWindow = () => (isIos() && typeof window !== 'undefined' ? window.open('', '_blank') : null)

const NEW_TAB_STYLE = '<style>.print-root{display:block!important}body{margin:0;padding:16px;background:#fff}'
  + '.print-bar{position:sticky;top:0;display:flex;gap:10px;justify-content:flex-end;padding:8px 0 12px;background:#fff}'
  + '.print-bar button{font:600 15px system-ui,sans-serif;background:#a0555c;color:#fff;border:0;border-radius:10px;padding:12px 18px}'
  + '@media print{.print-bar{display:none}}</style>'

function finishPrint(win, cleanup) {
  const root = document.querySelector('.print-root')
  if (win && root) {
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('')
    win.document.open()
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${location.origin}/"><title>${document.title}</title>${styles}${NEW_TAB_STYLE}</head><body><div class="print-bar"><button type="button" onclick="window.print()">Save as PDF / Print</button></div>${root.outerHTML}</body></html>`)
    win.document.close()
    cleanup()
    return
  }
  if (win) win.close() // iPhone but the payslip wasn't ready — fall back to the normal print below
  const done = () => { cleanup(); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
}

/** Prints payslips (the phone's print screen also saves them as a PDF). Pass `win` from openPrintWindow(). */
export async function printPayslips(slips, win = openPrintWindow()) {
  const title = document.title
  const first = slips[0]
  document.title = slips.length === 1 ? `Payslip ${first.name} ${monthLabel(first.month)}` : `Payslips ${monthLabel(first.month)}`
  state.printing = slips
  await nextTick()
  finishPrint(win, () => { state.printing = null; document.title = title })
}

/** Prints a report (month-end pack, tax year) — the phone's print screen also saves it as a PDF. */
export async function printReport(report, win = openPrintWindow()) {
  const title = document.title
  document.title = report.fileName || report.title
  state.printingReport = report
  await nextTick()
  finishPrint(win, () => { state.printingReport = null; document.title = title })
}
export const openPriceCalc = (focus = '') => (state.modal = { type: 'priceCalc', data: { focus } })
export const openInvoice = (client) => (state.modal = { type: 'invoice', data: { key: client.key } })
export const openReview = () => (state.modal = { type: 'review', data: null })
export const openMonthEnd = () => (state.modal = { type: 'monthEnd', data: null })
export const openTaxYear = () => (state.modal = { type: 'taxYear', data: null })

/* ---------------- the salon's Gmail (sends the app's emails) ---------------- */

export const openGmail = () => (state.modal = { type: 'gmail', data: null })

/* ---------------- the phone's back button ---------------- */

/*
 * Pages and pop-ups go into the browser history, so the phone's back button (or back gesture) closes an
 * open pop-up first, then goes back to the previous page — and from the first page leaves the app.
 */
let modalEntry = false // a history entry is holding an open pop-up
let ignorePops = 0 // our own history.back() calls, not the back button
let pendingView = null // a page change waiting for that history.back() to finish
const pageOk = (view) => view && view.startsWith('my-') === (state.role === 'staff')

function rememberPage(view) {
  if (typeof history === 'undefined') return
  // A pop-up is closing (e.g. Settings → Services): its entry goes first, then the new page.
  if (ignorePops || (modalEntry && !state.modal)) {
    pendingView = view
    return
  }
  if (modalEntry) return // the page changed under an open pop-up; its entry stays on top
  history.pushState({ llpView: view }, '')
}
/** Once the app knows its first page (after loading), that's the current history entry. */
function markFirstPage() {
  if (typeof history !== 'undefined' && !modalEntry) history.replaceState({ ...(history.state || {}), llpView: state.view }, '')
}

if (typeof window !== 'undefined') {
  history.replaceState({ ...(history.state || {}), llpView: state.view }, '')
  // A pop-up opens: add an entry for it. It closes some other way (✕, Cancel, swipe, Save): drop that entry.
  watch(() => !!state.modal, (open) => {
    if (open && !modalEntry) {
      history.pushState({ llpView: state.view, llpModal: true }, '')
      modalEntry = true
    } else if (!open && modalEntry) {
      modalEntry = false
      ignorePops++
      history.back()
    }
  })
  window.addEventListener('popstate', (e) => {
    if (ignorePops) {
      ignorePops--
      if (!ignorePops && pendingView) {
        history.pushState({ llpView: pendingView }, '')
        pendingView = null
      }
      return
    }
    if (modalEntry) {
      modalEntry = false
      state.modal = null
      return
    }
    const view = e.state?.llpView
    if (pageOk(view) && view !== state.view) {
      state.view = view
      state.selected.clear()
      window.scrollTo({ top: 0 })
    }
  })
}

/* ---------------- modals ---------------- */

/** Opens the appointment form: `appt` to edit, or `prefill` values for a new one. */
export const openAppointment = (appt, prefill = null) =>
  (state.modal = { type: 'appointment', data: appt ? { ...appt } : null, prefill })
export const openEmployee = (emp) => (state.modal = { type: 'employee', data: emp ? { ...emp } : null })
export const openClient = (client) => (state.modal = { type: 'client', data: client })
export const openPayment = (client) => (state.modal = { type: 'payment', data: client })
export const openDismissQuiet = (client) => (state.modal = { type: 'dismissQuiet', data: client })

/** Dismiss a client from the win-back list with an optional reason, or put them back (note = null). */
export async function dismissQuiet(client, note) {
  state.clientQuiet = await api('setQuietDismissed', client.key, client.name, note)
}

/** Record money a client paid (partial and/or split across methods, incl. a voucher). Returns what's owed. */
export async function recordPayment(key, payload) {
  const res = await api('recordPayment', key, payload)
  if (res.appts?.length) upsertAppts(res.appts)
  if (res.vouchers) state.vouchers = res.vouchers
  return res
}

/* ---------------- gift vouchers ---------------- */
export const openVouchers = () => (state.modal = { type: 'vouchers', data: null })
/** Vouchers with money still on them, newest first — for the payment picker and the list. */
export const liveVouchers = computed(() => state.vouchers.filter((v) => v.status === 'active' && v.balance > 0.005).sort((a, b) => (a.soldOn < b.soldOn ? 1 : -1)))
export async function sellVoucher(input) {
  const v = await api('sellVoucher', input)
  state.vouchers = [...state.vouchers, v]
  return v
}
export async function voidVoucher(id) {
  state.vouchers = await api('voidVoucher', id)
}
export const openSettings = () => (state.modal = { type: 'settings', data: null })
export const openHistory = () => {
  state.modal = { type: 'history', data: null }
  loadHistory()
}
export const openMerge = (client, opts = {}) => (state.modal = { type: 'merge', data: { client, with: opts.with || [], mode: opts.mode || 'merge' } })
/** Month/year picker sheet. mode 'month' sets state.month; 'year' sets state.year (Insights). */
export const openPicker = (mode = 'month') => (state.modal = { type: 'picker', data: { mode } })
export const closeModal = () => (state.modal = null)
