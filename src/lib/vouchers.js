/** Gift voucher rules shared by the app and the Worker. */

/**
 * The same day of the month, `n` months on. A day the target month doesn't have (the 31st, or the
 * 29th–31st for February) becomes that month's last day.
 */
export function addMonths(date, n) {
  const [y, m, d] = String(date).split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

export const DEFAULT_EXPIRY_MONTHS = 4

/** Default expiry: four months after the day it was sold. */
export const defaultExpiry = (soldOn) => addMonths(soldOn, DEFAULT_EXPIRY_MONTHS)

/** Expired on `today` (a voucher is still good on its expiry day). */
export const voucherExpired = (v, today) => !!(v.expiresOn && v.expiresOn < today)

/** Can still be taken as payment today. */
export const voucherUsable = (v, today) => v.status === 'active' && v.balance > 0.005 && !voucherExpired(v, today)

/** "Expiry changed 11 Nov 2026 by Stefni: 12 Mar 2027 → 30 Jun 2027" — appended to the voucher's expiry log. */
export function expiryChangeNote(by, on, from, to) {
  const d = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none')
  return `Expiry changed ${d(on)} by ${by}: ${d(from)} → ${d(to)}`
}
