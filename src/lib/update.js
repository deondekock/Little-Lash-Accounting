/* global __APP_VERSION__ */
/** Spotting a newer release of the app (after a deploy) and switching to it. */
export const APP_VERSION = __APP_VERSION__

/** True when the server has a newer version than the one running. Never throws. */
export async function newVersionAvailable() {
  if (!import.meta.env.PROD) return false
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'version.json', { cache: 'no-store' })
    if (!res.ok) return false
    const { version } = await res.json()
    return !!version && version !== APP_VERSION
  } catch {
    return false
  }
}

/** Loads the newest version: refreshes the offline copy, then reloads the page. */
export async function updateApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
    const keys = await caches?.keys()
    await Promise.all((keys || []).map((k) => caches.delete(k)))
  } catch { /* reload anyway */ }
  location.reload()
}
