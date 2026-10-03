/*
 * Persistent, per-device cache of the last /api/load payload, keyed by the server's data revision.
 * A cold start can then skip re-downloading the whole history when nothing has changed since last time —
 * it just probes the tiny /api/rev and reuses the stored copy. Everything is best-effort: any IndexedDB
 * failure (private mode, blocked storage) falls back to a normal network load.
 */
const DB = 'llp-cache'
const STORE = 'load'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run(mode, fn) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? req.result : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

/** The cached { rev, data } for this account, or null. */
export async function readLoadCache(key) {
  if (typeof indexedDB === 'undefined') return null
  try { return (await run('readonly', (s) => s.get(key))) || null } catch { return null }
}

/** Store the payload under the revision it was current at. */
export async function writeLoadCache(key, rev, data) {
  if (typeof indexedDB === 'undefined' || !rev) return
  try { await run('readwrite', (s) => s.put({ rev, data }, key)) } catch { /* ignore */ }
}

/** Forget a cached payload (e.g. on sign-out). Omit the key to clear everything. */
export async function clearLoadCache(key) {
  if (typeof indexedDB === 'undefined') return
  try { await run('readwrite', (s) => (key ? s.delete(key) : s.clear())) } catch { /* ignore */ }
}
