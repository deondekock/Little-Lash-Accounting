/**
 * South African public holidays (Public Holidays Act): the fixed dates, Good Friday and Family Day
 * (from Easter), and the Sunday rule — a holiday on a Sunday makes the Monday a holiday too.
 * One-off holidays (e.g. election days) aren't known in advance.
 */
const FIXED = [
  ['01-01', "New Year's Day"], ['03-21', 'Human Rights Day'], ['04-27', 'Freedom Day'], ['05-01', "Workers' Day"],
  ['06-16', 'Youth Day'], ['08-09', "National Women's Day"], ['09-24', 'Heritage Day'], ['12-16', 'Day of Reconciliation'],
  ['12-25', 'Christmas Day'], ['12-26', 'Day of Goodwill'],
]
const iso = (d) => d.toISOString().slice(0, 10)
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d))

/** Easter Sunday (Anonymous Gregorian algorithm). */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return utc(y, month, ((h + l - 7 * m + 114) % 31) + 1)
}

const cache = new Map()
/** [{ date: 'YYYY-MM-DD', name }] for a year, in date order. */
export function holidaysIn(year) {
  if (cache.has(year)) return cache.get(year)
  const out = FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name }))
  const e = easter(year)
  const shift = (days) => iso(new Date(e.getTime() + days * 864e5))
  out.push({ date: shift(-2), name: 'Good Friday' }, { date: shift(1), name: 'Family Day' })
  for (const h of [...out]) {
    if (new Date(h.date + 'T12:00:00Z').getUTCDay() === 0) {
      const monday = iso(new Date(Date.parse(h.date + 'T12:00:00Z') + 864e5))
      if (!out.some((x) => x.date === monday)) out.push({ date: monday, name: `${h.name} (observed)` })
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1))
  cache.set(year, out)
  return out
}

/** The holiday's name on this date, or ''. */
export function holidayOn(date) {
  if (!date) return ''
  return holidaysIn(Number(date.slice(0, 4))).find((h) => h.date === date)?.name || ''
}

/** Holidays between two dates, inclusive. */
export function holidaysBetween(from, to) {
  const out = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(...holidaysIn(y).filter((h) => h.date >= from && h.date <= to))
  return out
}
