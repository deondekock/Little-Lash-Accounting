import { reactive, computed } from 'vue'
import { call } from './api.js'
import { currentMonth, todayStr } from './lib/format.js'

export const state = reactive({
  ready: false,
  loadError: false,
  pending: 0,
  view: 'payments', // 'payments' | 'employees' | 'year'
  employees: [],
  spreadsheetUrl: '',
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
  toast(String(err?.message || err).replace(/^Exception:\s*/, ''), true)
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
  try {
    // Sequential on purpose: the first call creates the Google Sheet on first use.
    const data = await api('getInitialData')
    state.employees = data.employees
    state.spreadsheetUrl = data.spreadsheetUrl
    await loadMonth()
    state.ready = true
  } catch (err) {
    state.loadError = true
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
  if (saved.date.slice(0, 7) === state.month) {
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
  if (saved.date.slice(0, 7) !== state.month) await changeMonth(saved.date.slice(0, 7))
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
