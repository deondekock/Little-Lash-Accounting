/**
 * Booking rules, shared by the app and the Worker (so clients, staff and the owner see the same times).
 *
 * - Working hours per team member: { "1": [["08:00","17:00"]], … } by weekday (0 = Sunday); several
 *   ranges per day allow a lunch break.
 * - A service can take a different time (and cost a different price) per team member.
 * - Free times: inside her working hours, not on approved leave, not overlapping a booking or a
 *   block, on a 15-minute grid, from the minimum notice up to N days ahead.
 * Staff and the owner can still double-book on purpose (e.g. a brow tint during a lash fill);
 * clients only ever get times that are completely free.
 */

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DEFAULT_SCHEDULE = { 0: [], 1: [['08:00', '17:00']], 2: [['08:00', '17:00']], 3: [['08:00', '17:00']], 4: [['08:00', '17:00']], 5: [['08:00', '17:00']], 6: [['08:00', '13:00']] }
export const DEFAULT_MINUTES = 60

/** Online booking settings (rows in the settings table): [key, setting name, default]. */
export const BOOKING_FIELDS = [
  ['online', 'Online Booking', 'off'],
  ['daysAhead', 'Booking Days Ahead', 60],
  ['noticeHours', 'Booking Notice Hours', 2],
  ['step', 'Booking Step Minutes', 15],
  ['cancelHours', 'Booking Cancel Hours', 24],
  ['phone', 'Salon Phone', ''],
  ['message', 'Booking Message', ''],
]
export function bookingSettings(settings = {}) {
  const out = {}
  for (const [key, label, def] of BOOKING_FIELDS) {
    const v = settings[label]
    out[key] = typeof def === 'number' ? (v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : Number(v)) : String(v ?? def)
  }
  out.online = out.online === 'on'
  out.step = [5, 10, 15, 20, 30, 60].includes(out.step) ? out.step : 15
  return out
}

export const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const weekdayOf = (date) => new Date(date + 'T12:00:00Z').getUTCDay()
/** "Tue 3 Oct" */
export function dayName(date, long = false) {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short', timeZone: 'UTC' })
}
/** "10:00" → "10:00" (24 h, as South Africans read it); "2 h 15 min" for lengths. */
export function lengthLabel(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}

/** Working hours of a team member ({ weekday: [[from, to]] }), or the default. */
export function scheduleOf(emp) {
  let s = emp?.schedule
  if (typeof s === 'string') {
    try { s = JSON.parse(s) } catch { s = null }
  }
  return s && typeof s === 'object' ? s : DEFAULT_SCHEDULE
}

/** How a service works for one team member: { offered, price, minutes }. */
export function serviceFor(svc, empId) {
  const staff = Array.isArray(svc.staff) ? svc.staff : []
  const price = svc.prices?.[empId] ?? svc.price ?? null
  const minutes = Number(svc.durations?.[empId] ?? svc.minutes) || DEFAULT_MINUTES
  return { offered: staff.includes(empId), price, minutes }
}

/** Several services with one team member: total time and price, and whether she does them all. */
export function planFor(services, empId) {
  const items = services.map((s) => ({ id: s.id, name: s.name, ...serviceFor(s, empId) }))
  return {
    ok: items.length > 0 && items.every((i) => i.offered),
    minutes: items.reduce((t, i) => t + i.minutes, 0),
    price: items.every((i) => i.price != null) ? items.reduce((t, i) => t + i.price, 0) : null,
    items: items.map(({ offered, ...i }) => i),
  }
}

const onLeave = (empId, leave, date) =>
  leave.some((l) => l.employeeId === empId && (!l.status || l.status === 'approved') && l.from <= date && (l.to || l.from) >= date)

/** Times taken on that day by bookings and blocks: [[from, to]] in minutes. */
export function busyOn(empId, date, bookings) {
  return bookings
    .filter((b) => b.employeeId === empId && b.date === date && b.status !== 'cancelled' && b.status !== 'noshow')
    .map((b) => [toMin(b.start), toMin(b.start) + Number(b.minutes || 0)])
}

/** Free start times (minutes) for one team member on one day. */
export function freeTimes({ emp, date, minutes, bookings, leave, step = 15, earliest = 0 }) {
  if (onLeave(emp.id, leave, date)) return []
  const ranges = scheduleOf(emp)[weekdayOf(date)] || []
  const busy = busyOn(emp.id, date, bookings)
  const out = []
  for (const [from, to] of ranges) {
    const a = toMin(from)
    const z = toMin(to)
    for (let t = Math.ceil(Math.max(a, earliest) / step) * step; t + minutes <= z; t += step) {
      if (!busy.some(([s, e]) => t < e && s < t + minutes)) out.push(t)
    }
  }
  return out
}

/**
 * Open times for these services, per day from `from` for `days` days.
 * who = an employee id, or 'any' (each time goes to whoever is free and least busy that day).
 * now = { date, minutes } in the salon's time.
 * Returns [{ date, times: [{ time: 'HH:MM', employeeId, minutes, price }] }] (days with no times left out).
 */
export function openTimes({ services, employees, bookings, leave, settings, who = 'any', from, days = 14, now }) {
  const people = employees.filter((e) => e.active && (who === 'any' || e.id === who))
  const plans = people.map((e) => ({ e, plan: planFor(services, e.id) })).filter((x) => x.plan.ok)
  const last = addDays(now.date, settings.daysAhead)
  const noticeAt = now.minutes + settings.noticeHours * 60
  const out = []
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i)
    if (date < now.date || date > last) continue
    // Minimum notice may run into the next day(s).
    const earliest = date === now.date ? noticeAt : date === addDays(now.date, 1) && noticeAt > 1440 ? noticeAt - 1440 : 0
    const byTime = new Map()
    for (const { e, plan } of plans) {
      const load = bookings.filter((b) => b.employeeId === e.id && b.date === date && b.status !== 'cancelled').length
      for (const t of freeTimes({ emp: e, date, minutes: plan.minutes, bookings, leave, step: settings.step, earliest })) {
        const cur = byTime.get(t)
        if (!cur || load < cur.load) byTime.set(t, { time: toTime(t), employeeId: e.id, minutes: plan.minutes, price: plan.price, load })
      }
    }
    const times = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ time: v.time, employeeId: v.employeeId, minutes: v.minutes, price: v.price }))
    if (times.length) out.push({ date, times })
  }
  return out
}

/** The first open time from today on (looks up to the booking horizon). */
export function nextOpening(args) {
  const { now, settings } = args
  for (let from = now.date; from <= addDays(now.date, settings.daysAhead); from = addDays(from, 14)) {
    const found = openTimes({ ...args, from, days: 14 })
    if (found.length) return { date: found[0].date, ...found[0].times[0] }
  }
  return null
}

/** Salon time (South Africa, UTC+2, no daylight saving): { date, minutes }. */
export function salonNow(ms = Date.now()) {
  const d = new Date(ms + 2 * 3600e3)
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}
