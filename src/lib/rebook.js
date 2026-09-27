/**
 * Rebooking rate: of a team member's visits, how many clients came back to the salon within
 * REBOOK_DAYS (about one or two fill cycles) — and how many came back to *her*. A visit only counts
 * once that many days have passed (before that we can't know yet). A "visit" is one client on one day.
 */
import { clientKey, daysBetween } from './stats.js'
import { shiftMonth, monthRange } from './format.js'

export const REBOOK_DAYS = 42 // 6 weeks

const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/** Every client's visit days at the salon (anyone), sorted: Map key → ['YYYY-MM-DD', …]. */
export function salonDays(appts) {
  const map = new Map()
  for (const a of appts) {
    if (!a.client) continue
    const k = clientKey(a.client)
    if (!map.has(k)) map.set(k, new Set())
    map.get(k).add(a.date)
  }
  return new Map([...map].map(([k, s]) => [k, [...s].sort()]))
}

/**
 * Her visits between `from` and `to` (judged ones only) and how many came back.
 * @param appts  appointments (hers, or everyone's when employeeId is null)
 * @param days   salonDays() for the whole salon
 */
export function rebooking(appts, days, { employeeId = null, from, to, today, window = REBOOK_DAYS }) {
  const lastJudged = addDays(today, -window)
  const end = to < lastJudged ? to : lastJudged
  const mine = appts.filter((a) => a.client && (!employeeId || a.employeeId === employeeId))
  const herDays = new Map() // key → Set of her dates
  for (const a of mine) {
    const k = clientKey(a.client)
    if (!herDays.has(k)) herDays.set(k, new Set())
    herDays.get(k).add(a.date)
  }
  const r = { visits: 0, back: 0, backToHer: 0, newVisits: 0, newBack: 0 }
  for (const [k, set] of herDays) {
    const all = days.get(k) || [...set].sort()
    for (const d of set) {
      if (d < from || d > end) continue
      const next = all.find((x) => x > d)
      const back = !!next && daysBetween(d, next) <= window
      const isNew = all[0] === d
      r.visits++
      if (back) r.back++
      if (back && (!employeeId || set.has(next))) r.backToHer++
      if (isNew) {
        r.newVisits++
        if (back) r.newBack++
      }
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
  return { ...r, rate: pct(r.back, r.visits), herRate: pct(r.backToHer, r.visits), newRate: pct(r.newBack, r.newVisits), from, to: end }
}

/** The headline figure: visits in the ~3 months that can be judged (ending 6 weeks ago). */
export function recentRebooking(appts, days, { employeeId = null, today, window = REBOOK_DAYS }) {
  const to = addDays(today, -window)
  return rebooking(appts, days, { employeeId, from: addDays(to, -91), to, today, window })
}

/** Month by month (business months) for the last `months`, for a trend line; null where too few visits. */
export function rebookTrend(appts, days, { employeeId = null, today, startDay = 1, months = 12, window = REBOOK_DAYS }) {
  const lastMonth = shiftMonth(today.slice(0, 7), 0)
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(lastMonth, -i)
    const { from, to } = monthRange(m, startDay)
    if (from > addDays(today, -window)) break // nothing judged yet
    const r = rebooking(appts, days, { employeeId, from, to, today, window })
    out.push({ month: m, rate: r.visits >= 5 ? r.rate : null, visits: r.visits })
  }
  return out
}
