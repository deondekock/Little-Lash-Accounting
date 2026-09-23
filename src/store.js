import { reactive, computed } from 'vue'
import { call } from './api.js'
import { currentMonth, todayStr } from './lib/format.js'
import { CLIENT_ID, DEFAULT_SHEET_ID, FAKE_API } from './config.js'
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
  // 'loading' | 'config' (no Google client ID) | 'signedOut' | 'pickSheet' | 'ready' | 'error'
  phase: 'loading',
  email: '',
  loadedAt: 0,
  pending: 0,
  view: 'payments', // 'payments' | 'employees' | 'year'
  employees: [],
  spreadsheetUrl: '',
  monthStartDay: 1, // from the sheet's Settings tab; 26 → "July" = 26 Jun – 25 Jul
  month: currentMonth(),
  year: new Date().getFullYear(),
  appts: [], // appointments for state.month
  yearAppts: null, // appointments for state.year, loaded on demand
  employee: 'all', // employee filter: 'all' or an employee id
  status: 'all', // 'all' | 'Paid' | 'Unpaid'
  selected: new Set(),
  modal: null, // { type: 'appointment' | 'employee', data }
  toast: null, // { msg, error }
})

export const employeeById = (id) => state.employees.find((e) => e.id === id)

/** Month appointments for the selected employee (ignores the status filter). */
export const employeeAppts = computed(() =>
  state.employee === 'all' ? state.appts : state.appts.filter((a) => a.employeeId === state.employee),
)

/** Month appointments for the selected employee and status. */
export const visibleAppts = computed(() =>
  state.status === 'all' ? employeeAppts.value : employeeAppts.value.filter((a) => a.status === state.status),
)

/* ---------------- feedback ---------------- */

let toastTimer
export function toast(msg, error = false) {
  state.toast = { msg, error }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (state.toast = null), error ? 5000 : 2200)
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
  if (!state.email) auth.fetchEmail().then((e) => (state.email = e)).catch(() => {})
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
    state.employees = data.employees
    state.spreadsheetUrl = data.spreadsheetUrl
    state.monthStartDay = data.monthStartDay || 1
    state.month = currentMonth(state.monthStartDay)
    state.year = Number(state.month.slice(0, 4))
    state.yearAppts = null
    await loadMonth()
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
    const data = await api('getInitialData')
    state.employees = data.employees
    state.monthStartDay = data.monthStartDay || 1
    state.yearAppts = null
    await loadMonth()
    if (state.view === 'year') loadYear()
    state.loadedAt = Date.now()
  } catch (err) {
    fail(err)
  }
}

async function loadMonth() {
  const month = state.month
  const appts = await api('getAppointments', month)
  if (month === state.month) {
    state.appts = appts
    state.selected.clear()
  }
}

export async function changeMonth(month) {
  state.month = month
  state.appts = []
  state.selected.clear()
  try {
    await loadMonth()
  } catch (err) {
    fail(err)
  }
}

export async function loadYear() {
  const year = state.year
  try {
    const appts = await api('getAppointments', String(year))
    if (year === state.year) state.yearAppts = appts
  } catch (err) {
    fail(err)
  }
}

export function changeYear(delta) {
  state.year += delta
  state.yearAppts = null
  loadYear()
}

export function setView(view) {
  state.view = view
  if (view === 'year') {
    const year = Number(state.month.slice(0, 4))
    if (year !== state.year || !state.yearAppts) {
      state.year = year
      state.yearAppts = null
      loadYear()
    }
  }
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

function upsertAppt(saved) {
  const i = state.appts.findIndex((x) => x.id === saved.id)
  if (saved.month === state.month) {
    if (i >= 0) state.appts[i] = saved
    else state.appts.push(saved)
  } else if (i >= 0) {
    state.appts.splice(i, 1)
  }
  state.yearAppts = null
}

export async function saveAppointment(data) {
  const saved = await api('saveAppointment', data)
  upsertAppt(saved)
  if (saved.month !== state.month) await changeMonth(saved.month)
  return saved
}

export async function deleteAppointment(id) {
  await api('deleteAppointment', id)
  state.appts = state.appts.filter((x) => x.id !== id)
  state.selected.delete(id)
  state.yearAppts = null
}

/** Changes status and/or method on several appointments. Optimistic, so taps feel instant. */
export async function updateMany(ids, changes) {
  const before = state.appts.map((a) => ({ ...a }))
  for (const a of state.appts) {
    if (!ids.includes(a.id)) continue
    if (changes.method) a.method = changes.method
    if (changes.status) {
      if (changes.status === 'Paid' && a.status !== 'Paid') a.paidOn = todayStr()
      if (changes.status === 'Unpaid') a.paidOn = ''
      a.status = changes.status
    }
  }
  try {
    const updated = await api('updateAppointments', ids, changes)
    updated.forEach(upsertAppt)
    return true
  } catch (err) {
    state.appts = before
    fail(err)
    return false
  }
}

/* ---------------- employees ---------------- */

export async function saveEmployee(payload) {
  state.employees = await api('saveEmployee', payload)
  if (payload.id) {
    const name = payload.name.trim()
    state.appts.forEach((a) => {
      if (a.employeeId === payload.id) a.employeeName = name
    })
    state.yearAppts = null
  }
}

export async function deleteEmployee(id) {
  state.employees = await api('deleteEmployee', id)
  if (state.employee === id) state.employee = 'all'
}

/* ---------------- modals ---------------- */

export const openAppointment = (appt) => (state.modal = { type: 'appointment', data: appt ? { ...appt } : null })
export const openEmployee = (emp) => (state.modal = { type: 'employee', data: emp ? { ...emp } : null })
export const closeModal = () => (state.modal = null)
