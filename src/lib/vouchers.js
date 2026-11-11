/** Gift voucher rules shared by the app and the Worker. */

/** Default expiry: one year after the day it was sold. */
export function defaultExpiry(soldOn) {
  const [y, m, d] = String(soldOn).split('-').map(Number)
  const end = new Date(Date.UTC(y + 1, m - 1, d))
  // 29 Feb → 28 Feb the next year
  if (end.getUTCMonth() !== m - 1) end.setUTCDate(0)
  return end.toISOString().slice(0, 10)
}

/** Expired on `today` (a voucher is still good on its expiry day). */
export const voucherExpired = (v, today) => !!(v.expiresOn && v.expiresOn < today)

/** Can still be taken as payment today. */
export const voucherUsable = (v, today) => v.status === 'active' && v.balance > 0.005 && !voucherExpired(v, today)

/** "Expiry changed 11 Nov 2026 by Stefni: 12 Mar 2027 → 30 Jun 2027" — appended to the voucher's expiry log. */
export function expiryChangeNote(by, on, from, to) {
  const d = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none')
  return `Expiry changed ${d(on)} by ${by}: ${d(from)} → ${d(to)}`
}
