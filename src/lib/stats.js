/** Aggregations behind the dashboard, clients and insights screens. */
import { monthRange, shiftMonth, todayStr } from './format.js'

const DAY = 864e5
const toTime = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
const toDate = (t) => new Date(t).toISOString().slice(0, 10)
export const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY)

/** Every date ('YYYY-MM-DD') in a business month. */
export function periodDates(month, startDay) {
  const { from, to } = monthRange(month, startDay)
  const out = []
  for (let t = toTime(from); t <= toTime(to); t += DAY) out.push(toDate(t))
  return out
}

/**
 * Running total per day of a business month: [{ date, value }].
 * Stops at `upTo` (e.g. today) so the current month's line ends where we are.
 */
export function cumulative(list, month, startDay, upTo) {
  const perDay = new Map()
  for (const a of list) perDay.set(a.date, (perDay.get(a.date) || 0) + a.amount)
  let sum = 0
  const out = []
  for (const date of periodDates(month, startDay)) {
    if (upTo && date > upTo) break
    sum += perDay.get(date) || 0
    out.push({ date, value: sum })
  }
  return out
}

/** This month so far vs. last month at the same point in its period. */
export function monthToDate(all, month, startDay) {
  const today = todayStr()
  const dates = periodDates(month, startDay)
  const inProgress = today >= dates[0] && today <= dates[dates.length - 1]
  const dayIndex = inProgress ? dates.indexOf(today) : dates.length - 1
  const prevMonth = shiftMonth(month, -1)
  const prevDates = periodDates(prevMonth, startDay)
  const prevCut = prevDates[Math.min(dayIndex, prevDates.length - 1)]
  const cur = all.filter((a) => a.month === month)
  const prev = all.filter((a) => a.month === prevMonth)
  const curTotal = cur.reduce((s, a) => s + a.amount, 0)
  const prevSame = prev.filter((a) => a.date <= prevCut).reduce((s, a) => s + a.amount, 0)
  return {
    inProgress,
    curTotal,
    prevSame,
    prevTotal: prev.reduce((s, a) => s + a.amount, 0),
    change: prevSame ? (curTotal - prevSame) / prevSame : null,
    current: cumulative(cur, month, startDay, inProgress ? today : null),
    previous: cumulative(prev, prevMonth, startDay),
    prevMonth,
  }
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Appointments and takings per weekday (Mon first). */
export function byWeekday(list) {
  const out = WEEKDAYS.map((label) => ({ label, count: 0, total: 0 }))
  for (const a of list) {
    const d = (new Date(toTime(a.date)).getUTCDay() + 6) % 7
    out[d].count++
    out[d].total += a.amount
  }
  return out
}

/** Same person typed slightly differently ("Irené " / "irené") → one key. */
export const clientKey = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ')

function mostCommon(counter) {
  let best = ''
  let n = -1
  for (const [k, v] of counter) if (v > n) [best, n] = [k, v]
  return best
}

/**
 * One entry per client: visits, spend, first/last visit, usual service and
 * staff, typical days between visits, and whether a refill is due.
 */
export function buildClients(all) {
  const map = new Map()
  for (const a of all) {
    if (!a.client) continue
    const key = clientKey(a.client)
    let c = map.get(key)
    if (!c) {
      c = { key, spellings: new Map(), visits: [], services: new Map(), staff: new Map() }
      map.set(key, c)
    }
    c.spellings.set(a.client.trim(), (c.spellings.get(a.client.trim()) || 0) + 1)
    c.visits.push(a)
    if (a.service) c.services.set(a.service, (c.services.get(a.service) || 0) + 1)
    c.staff.set(a.employeeId, (c.staff.get(a.employeeId) || 0) + 1)
  }
  const today = todayStr()
  const out = []
  for (const c of map.values()) {
    c.visits.sort((x, y) => (x.date < y.date ? 1 : -1))
    const dates = [...new Set(c.visits.map((v) => v.date))].sort()
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter((g) => g > 0)
    const recentGaps = gaps.slice(-6).sort((x, y) => x - y)
    const usualGap = recentGaps.length ? recentGaps[Math.floor(recentGaps.length / 2)] : null
    const last = dates[dates.length - 1]
    const since = daysBetween(last, today)
    out.push({
      key: c.key,
      name: mostCommon(c.spellings),
      visits: dates.length,
      spend: c.visits.reduce((s, v) => s + v.amount, 0),
      first: dates[0],
      last,
      daysSince: since,
      usualGap,
      service: mostCommon(c.services),
      staffId: mostCommon(c.staff),
      history: c.visits,
      unpaid: c.visits.filter((v) => v.status !== 'Paid').reduce((s, v) => s + v.amount, 0),
      // A regular (3+ visits, comes back within ~6 weeks) who is now past her usual time.
      due: dates.length >= 3 && usualGap && usualGap <= 42 && since > usualGap + 3 && since <= 120,
    })
  }
  return out
}

/** Totals per business month of a year → 12 entries. */
export function monthlyTotals(list, year) {
  const out = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, total: 0, count: 0 }))
  for (const a of list) {
    if (!a.month.startsWith(String(year))) continue
    const m = +a.month.slice(5, 7) - 1
    out[m].total += a.amount
    out[m].count++
  }
  return out
}

/** Short compact money for axes: R 12k, R 1.2k, R 850. */
export function compactMoney(n) {
  if (n >= 1e6) return 'R ' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'M'
  if (n >= 1e3) return 'R ' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + 'k'
  return 'R ' + Math.round(n)
}

/** Clean axis ticks from 0 to ≥ max. */
export function niceTicks(max, count = 4) {
  if (max <= 0) return [0]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}
