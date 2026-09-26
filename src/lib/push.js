/** Push notifications on this phone (via the service worker). */

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

function keyBytes(b64url) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))])
  if (!reg) throw new Error('The app isn\'t fully installed yet. Close it, open it again, and try once more.')
  return reg
}

/** This phone's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null
  return (await registration()).pushManager.getSubscription()
}

/** Asks permission and subscribes this phone. Returns the subscription (as JSON for the server). */
export async function subscribePush(vapidKey) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this app. Allow them in the phone\'s settings (or the browser\'s site settings), then try again.'
      : 'Notifications weren\'t allowed.')
  }
  const reg = await registration()
  const existing = await reg.pushManager.getSubscription()
  const sub = existing || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }))
  return sub.toJSON()
}

/** Unsubscribes this phone. Returns the endpoint that was removed (or null). */
export async function unsubscribePush() {
  const sub = await currentSubscription()
  if (!sub) return null
  await sub.unsubscribe()
  return sub.endpoint
}
