export const METHODS = ['Cash', 'Card', 'EFT']

const money = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })
export const fmt = (n) => money.format(n || 0)

export const ym = (y, m) => y + '-' + String(m).padStart(2, '0')

export function currentMonth() {
  const d = new Date()
  return ym(d.getFullYear(), d.getMonth() + 1)
}

export function todayStr() {
  const d = new Date()
  return ym(d.getFullYear(), d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0')
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return ym(d.getFullYear(), d.getMonth() + 1)
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

export const monthName = (m) => new Date(2000, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long' })

export function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')
}

export function emptyTotals() {
  return { count: 0, total: 0, paid: 0, unpaid: 0, paidCount: 0, unpaidCount: 0, Cash: 0, Card: 0, EFT: 0 }
}

export function totals(list) {
  const t = emptyTotals()
  for (const a of list) {
    t.count++
    t.total += a.amount
    if (a.status === 'Paid') {
      t.paid += a.amount
      t.paidCount++
    } else {
      t.unpaid += a.amount
      t.unpaidCount++
    }
    if (a.method in t) t[a.method] += a.amount
  }
  return t
}

/** Groups appointments per employee → [{ id, name, t }] sorted by name. */
export function byEmployee(list, employees) {
  const map = new Map()
  for (const a of list) {
    if (!map.has(a.employeeId)) map.set(a.employeeId, [])
    map.get(a.employeeId).push(a)
  }
  return [...map.entries()]
    .map(([id, items]) => ({
      id,
      name: employees.find((e) => e.id === id)?.name || items[0].employeeName,
      t: totals(items),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
