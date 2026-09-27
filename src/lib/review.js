/**
 * "Year in review" — a look back at one year (business months Jan–Dec) for the salon or one team member.
 * Works from appointments only. `withMoney` false leaves out every rand figure (for staff).
 */
import { clientKey, WEEKDAYS, ordinal } from './stats.js'
import { monthLabel, shortDate } from './format.js'
import { splitServices, serviceKey } from './services.js'
import { MILESTONES } from './schema.js'

const DAY = 864e5
const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const top = (map, n = 1) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)

export function yearReview(appts, year, { employees = [], withMoney = true } = {}) {
  const y = String(year)
  const inYear = appts.filter((a) => a.month.startsWith(y))
  const lastYear = appts.filter((a) => a.month.startsWith(String(year - 1)))
  if (!inYear.length) return null

  // Every client's visit days (one visit per client per day), all time, oldest first.
  const days = new Map()
  const names = new Map()
  for (const a of appts) {
    if (!a.client) continue
    const k = clientKey(a.client)
    if (!days.has(k)) days.set(k, new Set())
    days.get(k).add(a.date)
    if (!names.has(k) || a.month.startsWith(y)) names.set(k, a.client.trim())
  }
  const sorted = new Map([...days].map(([k, s]) => [k, [...s].sort()]))

  const clientsThisYear = new Set(inYear.filter((a) => a.client).map((a) => clientKey(a.client)))
  let newClients = 0
  let cameBack = 0
  const milestones = []
  const visitsThisYear = new Map()
  for (const k of clientsThisYear) {
    const list = sorted.get(k)
    if (list[0].slice(0, 4) === y) newClients++
    const mine = list.filter((d) => d.slice(0, 4) === y)
    visitsThisYear.set(k, mine.length)
    // Back after 6+ months away.
    for (let i = 1; i < list.length; i++) {
      if (list[i].slice(0, 4) !== y) continue
      if ((t(list[i]) - t(list[i - 1])) / DAY >= 180) { cameBack++; break }
    }
    // Milestones reached this year (the 10th, 25th… visit fell in this year).
    for (const m of MILESTONES) {
      const d = list[m - 1]
      if (d && d.slice(0, 4) === y) milestones.push({ name: names.get(k), milestone: m, label: ordinal(m), date: d })
    }
  }

  const byMonth = new Map()
  const byMonthMoney = new Map()
  const byWeekday = new Map()
  const byDay = new Map()
  const methods = new Map()
  const services = new Map()
  let total = 0
  for (const a of inYear) {
    total += a.amount
    byMonth.set(a.month, (byMonth.get(a.month) || 0) + 1)
    byMonthMoney.set(a.month, (byMonthMoney.get(a.month) || 0) + a.amount)
    const wd = WEEKDAYS[(new Date(t(a.date)).getUTCDay() + 6) % 7]
    byWeekday.set(wd, (byWeekday.get(wd) || 0) + 1)
    byDay.set(a.date, (byDay.get(a.date) || 0) + 1)
    if (a.method) methods.set(a.method, (methods.get(a.method) || 0) + 1)
    for (const s of splitServices(a.service)) {
      const k = serviceKey(s)
      const e = services.get(k) || { name: s, n: 0 }
      e.n++
      services.set(k, e)
    }
  }
  const lastTotal = lastYear.reduce((s, a) => s + a.amount, 0)
  const [busiestMonth] = top(byMonth)
  const [busiestWeekday] = top(byWeekday)
  const [biggestDay] = top(byDay)
  const [favMethod] = top(methods)
  const loyal = top(visitsThisYear, 5).map(([k, n]) => ({ name: names.get(k), visits: n }))
  const withService = inYear.filter((a) => a.service).length
  const topServices = withService / inYear.length >= 0.3
    ? [...services.values()].sort((a, b) => b.n - a.n).slice(0, 5)
    : []
  const team = employees
    .map((e) => {
      const mine = inYear.filter((a) => a.employeeId === e.id)
      return { id: e.id, name: e.name, visits: mine.length, clients: new Set(mine.filter((a) => a.client).map((a) => clientKey(a.client))).size, total: mine.reduce((s, a) => s + a.amount, 0) }
    })
    .filter((x) => x.visits)
    .sort((a, b) => b.visits - a.visits)

  return {
    year,
    visits: inYear.length,
    lastVisits: lastYear.length,
    clients: clientsThisYear.size,
    newClients,
    cameBack,
    total: withMoney ? total : null,
    lastTotal: withMoney ? lastTotal : null,
    change: withMoney && lastTotal ? (total - lastTotal) / lastTotal : lastYear.length ? (inYear.length - lastYear.length) / lastYear.length : null,
    busiestMonth: busiestMonth && { label: monthLabel(busiestMonth[0]).split(' ')[0], visits: busiestMonth[1], total: withMoney ? byMonthMoney.get(busiestMonth[0]) : null },
    busiestWeekday: busiestWeekday && { label: { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[busiestWeekday[0]], visits: busiestWeekday[1] },
    biggestDay: biggestDay && { label: `${shortDate(biggestDay[0])}`, visits: biggestDay[1] },
    favMethod: favMethod && { label: favMethod[0], share: Math.round((favMethod[1] / inYear.length) * 100) },
    loyal,
    milestones: milestones.sort((a, b) => b.milestone - a.milestone || (a.date < b.date ? -1 : 1)),
    topServices,
    team: withMoney ? team : team.map(({ total: _, ...x }) => x),
  }
}

/** A short text version for sharing (WhatsApp, Instagram…) — no client names or rands. */
export function reviewText(r, who = 'Little Lash Lounge') {
  const lines = [`✨ ${who} · ${r.year} in review ✨`, '',
    `💅 ${r.visits.toLocaleString('en-ZA')} appointments`,
    `💕 ${r.clients.toLocaleString('en-ZA')} clients, ${r.newClients} of them new`]
  if (r.busiestMonth) lines.push(`📅 Busiest month: ${r.busiestMonth.label}`)
  if (r.milestones.length) lines.push(`🎉 ${r.milestones.length} loyalty milestone${r.milestones.length === 1 ? '' : 's'}`)
  if (r.cameBack) lines.push(`🌸 ${r.cameBack} clients came back after 6+ months`)
  lines.push('', 'Thank you to every client who trusted us with their lashes 💕')
  return lines.join('\n')
}
