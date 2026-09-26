/*
 * Service worker: makes the app installable and open instantly.
 * - Page loads: network first (so updates show up), cached copy when offline.
 * - App files (JS/CSS/icons): served from cache, refreshed in the background.
 * - Google (sign-in) and the data (Cloudflare) are never cached.
 * - Push notifications: shown here; tapping one opens (or focuses) the app on the right page.
 */
const CACHE = 'llp-v2'
// Paths are relative to where the app is served from (e.g. /Little-Lash-Accounting/ on GitHub Pages).
const BASE = new URL('./', self.location).pathname
const SHELL = [BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon.svg', BASE + 'icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(BASE, copy))
          return res
        })
        .catch(() => caches.match(BASE)),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || fresh
    }),
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Little Lash Lounge', body: event.data?.text() || '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Little Lash Lounge', {
      body: data.body || '',
      icon: BASE + 'icons/icon-192.png',
      badge: BASE + 'icons/icon-192.png',
      tag: data.tag || undefined,
      data: { url: data.url || BASE },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || BASE
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).pathname.startsWith(BASE))
      if (open) {
        open.postMessage({ type: 'open', hash: new URL(url).hash })
        return open.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
