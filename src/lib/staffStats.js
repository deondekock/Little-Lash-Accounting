/**
 * A team member's own stats — counts, visits and client loyalty only (never rands, never compared
 * with colleagues). Works from her appointments, which reach her phone without amounts.
 */
import { businessMonth, monthRange, shiftMonth } from './format.js'
import { clientFlow, clientKey, daysBetween, WEEKDAYS } from './stats.js'
import { splitServices, serviceKey } from './services.js'

const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = (date) => (new Date(date + 'T12:00:00').getDay() + 6) % 7 // Mon = 0
/** Monday of that date's week. */
const weekStart = (date) => addDays(date, -weekday(date))

/** This business month so far vs the same point last month, days worked, busiest day, unpaid, overtime. */
export function monthProgress(appts, startDay, today) {
  const month = businessMonth(today, startDay)
  const r = monthRange(month, startDay)
  const dayNo = daysBetween(r.from, today) // 0 on the first day
  const prev = shiftMonth(month, -1)
  const prevCut = addDays(monthRange(prev, startDay).from, dayNo)
  const cur = appts.filter((a) => a.month === month && a.date <= today)
  const prevSame = appts.filter((a) => a.month === prev && a.date <= prevCut).length
  const perDay = new Array(7).fill(0)
  for (const a of cur) perDay[weekday(a.date)]++
  const top = Math.max(...perDay)
  const open = [prev, month]
  let overtime = 0
  for (const a of cur) {
    if (a.overtime === 'all') overtime += a.length || 0
    else if (a.overtime) overtime += Number(a.overtime) || 0
  }
  return {
    month,
    count: cur.length,
    prevSame,
    change: cur.length - prevSame,
    daysWorked: new Set(cur.map((a) => a.date)).size,
    busiest: top ? WEEKDAYS[perDay.indexOf(top)] : '',
    unpaid: appts.filter((a) => open.includes(a.month) && a.status !== 'Paid').length,
    overtimeMinutes: overtime,
  }
}

/** New / 2nd-3rd visit / regular clients this month, last month's new clients who came back, and rebooking. */
export function loyalty(appts, employeeId, month) {
  const f = clientFlow(appts, month)[employeeId] || {}
  const n = (k) => (f[k] || []).length
  // Rebooking: of the clients she saw last month, how many have been back since their visit.
  const prev = shiftMonth(month, -1)
  const lastVisit = new Map()
  for (const a of appts) {
    if (a.month !== prev || !a.client) continue
    const k = clientKey(a.client)
    if (!lastVisit.has(k) || a.date > lastVisit.get(k)) lastVisit.set(k, a.date)
  }
  let back = 0
  for (const [k, d] of lastVisit) if (appts.some((a) => a.client && clientKey(a.client) === k && a.date > d)) back++
  return {
    newClients: n('new'),
    returning: n('returning'),
    regulars: n('regular'),
    lastMonthNew: n('lastMonthNew'),
    cameBack: n('cameBack'),
    names: { new: f.new || [], cameBack: f.cameBack || [] },
    rebook: { seen: lastVisit.size, back, pct: lastVisit.size ? Math.round((back / lastVisit.size) * 100) : null },
  }
}

/** Her top services this month (by count), and ones she did for the first time. */
export function serviceMix(appts, month) {
  const count = new Map()
  const name = new Map()
  const firstSeen = new Map()
  for (const a of [...appts].sort((x, y) => (x.date < y.date ? -1 : 1))) {
    for (const s of splitServices(a.service)) {
      const k = serviceKey(s)
      if (!k) continue
      if (!firstSeen.has(k)) firstSeen.set(k, a.month)
      if (a.month === month) {
        count.set(k, (count.get(k) || 0) + 1)
        name.set(k, s)
      }
    }
  }
  const top = [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => ({ name: name.get(k), count: n }))
  const firsts = [...count.keys()].filter((k) => firstSeen.get(k) === month && appts.some((a) => a.month < month)).map((k) => name.get(k))
  return { top, max: top[0]?.count || 0, firsts }
}

const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000]
const CLIENT_MILESTONES = [10, 25, 50, 75, 100]

/** Appointment milestones, best week ever, client milestones this week, and her work anniversary. */
export function milestones(appts, today, engaged = '') {
  const sorted = [...appts].filter((a) => a.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '').localeCompare(b.createdAt || '')))
  const total = sorted.length
  const reached = MILESTONES.filter((m) => m <= total).pop() || 0
  const reachedOn = reached ? sorted[reached - 1].date : ''
  const next = MILESTONES.find((m) => m > total) || null
  // Weeks (Mon–Sun)
  const weeks = new Map()
  for (const a of sorted) weeks.set(weekStart(a.date), (weeks.get(weekStart(a.date)) || 0) + 1)
  const thisWeek = weeks.get(weekStart(today)) || 0
  let best = { start: '', count: 0 }
  for (const [start, count] of weeks) if (count > best.count) best = { start, count }
  // Clients reaching 10 / 25 / 50… visits with her in the last 7 days (one visit per day).
  const perClient = new Map()
  const clientMoments = []
  for (const a of sorted) {
    if (!a.client) continue
    const k = clientKey(a.client)
    const c = perClient.get(k) || { days: new Set(), name: a.client.trim() }
    if (c.days.has(a.date)) continue
    c.days.add(a.date)
    perClient.set(k, c)
    if (CLIENT_MILESTONES.includes(c.days.size) && daysBetween(a.date, today) < 7) clientMoments.push({ name: c.name, visits: c.days.size, date: a.date })
  }
  // Work anniversary
  let anniversary = null
  if (engaged && engaged <= today) {
    const years = Number(today.slice(0, 4)) - Number(engaged.slice(0, 4)) - (today.slice(5) < engaged.slice(5) ? 1 : 0)
    const months = (Number(today.slice(0, 4)) - Number(engaged.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(engaged.slice(5, 7)) - (today.slice(8) < engaged.slice(8) ? 1 : 0)
    anniversary = { years, months: months % 12, today: years > 0 && today.slice(5) === engaged.slice(5) }
  }
  return {
    total,
    reached, reachedOn, recent: reached && daysBetween(reachedOn, today) < 14,
    next, toGo: next ? next - total : 0,
    best, thisWeek, bestIsNow: best.start === weekStart(today) && best.count > 1,
    clientMoments: clientMoments.reverse(),
    anniversary,
  }
}
