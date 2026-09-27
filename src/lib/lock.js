/**
 * The app lock on this phone: when the owner has a passcode, the app asks for it again after she's been
 * away for a while (her choice per phone). The passcode itself is checked by the Worker.
 */
const KEYS = { set: 'llp.pinSet', after: 'llp.lockAfter', seen: 'llp.lastSeen' }
const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k, v) => { try { localStorage.setItem(k, String(v)) } catch { /* private mode */ } }

/** Minutes away before it locks: 0 = every time, -1 = only when signing in on a new phone. */
export const LOCK_CHOICES = [[0, 'Every time I open it'], [5, 'After 5 minutes away'], [30, 'After 30 minutes away'], [60, 'After an hour away'], [-1, 'Only when signing in']]
export const lockAfter = () => (get(KEYS.after) === null ? 5 : Number(get(KEYS.after)))
export const setLockAfter = (m) => put(KEYS.after, m)
export const pinSetHere = () => get(KEYS.set) === '1'
export const rememberPinSet = (on) => put(KEYS.set, on ? '1' : '0')
export const markSeen = () => put(KEYS.seen, Date.now())

export function shouldLock() {
  if (!pinSetHere()) return false
  const m = lockAfter()
  if (m < 0) return false
  const seen = Number(get(KEYS.seen)) || 0
  return !seen || Date.now() - seen >= m * 60000
}
