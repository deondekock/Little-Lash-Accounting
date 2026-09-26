/**
 * Little Lash Lounge API — a Cloudflare Worker in front of the D1 database.
 *
 * Every request carries the Google sign-in token from the app. It is checked with Google
 * and only the addresses in the ALLOWED_EMAILS secret get in.
 *
 *   GET  /api/load               everything the app needs (all tables, settings)
 *   POST /api/write              add / change / delete records in one transaction, with a history entry
 *   GET  /api/history            recent history entries (without the stored records)
 *   GET  /api/history?since=T    entries from time T on, with their stored records (for undo)
 *
 * Every night a copy of the whole database goes into the BACKUPS KV store (kept 35 days).
 * The Worker hardly parses anything: SQLite builds the JSON, so big loads stay cheap.
 */
import { TABLES } from '../../src/lib/schema.js'

const HISTORY_COLS = ['id', 'time', 'who', 'action', 'summary', 'undone_at']
const MAX_HISTORY = 400

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      const url = new URL(request.url)
      if (url.pathname === '/') return text('Little Lash Lounge API', 200, cors)
      const who = await authenticate(request, env, ctx)
      if (url.pathname === '/api/load' && request.method === 'GET') return json(await loadAll(env.DB), cors)
      if (url.pathname === '/api/write' && request.method === 'POST') return await write(env.DB, await request.json(), cors)
      if (url.pathname === '/api/history' && request.method === 'GET') return json(await history(env.DB, url.searchParams.get('since')), cors)
      if (url.pathname === '/api/me') return json(JSON.stringify({ email: who }), cors)
      return text('Not found', 404, cors)
    } catch (err) {
      const status = err.status || 500
      if (status === 500) console.error(err)
      return new Response(JSON.stringify({ error: err.message || String(err) }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
  },

  /** Nightly backup of everything into KV. */
  async scheduled(event, env) {
    const day = new Date().toISOString().slice(0, 10)
    const body = await loadAll(env.DB, { withHistory: true })
    await env.BACKUPS.put(`backup/${day}`, body, { expirationTtl: 35 * 86400 })
  },
}

/* ---------------- auth ---------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Checks the Google access token (cached for a few minutes) and the email allow-list. */
async function authenticate(request, env, ctx) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Please sign in.')
  // Local development only (set in worker/.dev.vars, never in production).
  if (env.DEV_EMAIL) return env.DEV_EMAIL
  const cache = caches.default
  const key = new Request(`https://auth.cache/${await sha256(token)}`)
  let info = await cache.match(key).then((r) => r && r.json())
  if (!info) {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
    if (!res.ok) throw new HttpError(401, 'Your Google sign-in expired. Please sign in again.')
    info = await res.json()
    const ttl = Math.max(0, Math.min(Number(info.expires_in) || 0, 300))
    if (ttl) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(info), { headers: { 'Cache-Control': `max-age=${ttl}` } })))
  }
  if (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, 'Please sign in again.')
  const email = String(info.email || '').toLowerCase()
  const allowed = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean)
  if (!email || String(info.email_verified) !== 'true' || !allowed.includes(email)) {
    throw new HttpError(403, `${info.email || 'This Google account'} doesn't have access to the salon's data.`)
  }
  return email
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const ok = allowed.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body, cors) => new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const text = (body, status, cors) => new Response(body, { status, headers: cors })

/* ---------------- reading ---------------- */

/** A JSON array of arrays (columns in TABLES order), built by SQLite. */
const arraysOf = (table, where = '') =>
  `SELECT json_group_array(json_array(${TABLES[table].join(', ')})) AS j FROM (SELECT * FROM ${table} ${where})`

/** Everything as one JSON string: { employees: [[…]], appointments: [[…]], …, settings: [[k, v]] }. */
async function loadAll(db, { withHistory = false } = {}) {
  // Appointments come per year so no single result gets too big.
  const years = (await db.prepare('SELECT DISTINCT substr(month, 1, 4) AS y FROM appointments ORDER BY y').all()).results.map((r) => r.y)
  const small = ['employees', 'services', 'leave', 'payslips']
  const stmts = [
    ...small.map((t) => db.prepare(arraysOf(t))),
    db.prepare('SELECT json_group_array(json_array(key, value)) AS j FROM settings'),
    ...years.map((y) => db.prepare(arraysOf('appointments', 'WHERE month >= ?1 AND month < ?2')).bind(y, String(Number(y) + 1))),
  ]
  if (withHistory) stmts.push(db.prepare(`SELECT json_group_array(json_array(${[...HISTORY_COLS, 'data'].join(', ')})) AS j FROM history`))
  const res = await db.batch(stmts)
  const out = res.map((r) => r.results[0]?.j || '[]')
  const inner = (a) => a.slice(1, -1)
  const appts = out.slice(small.length + 1, small.length + 1 + years.length).map(inner).filter(Boolean).join(',')
  let body = '{' + small.map((t, i) => `"${t}":${out[i]}`).join(',') + `,"settings":${out[small.length]},"appointments":[${appts}]`
  if (withHistory) body += `,"history":${out[out.length - 1]}`
  return body + '}'
}

async function history(db, since) {
  if (since) {
    const r = await db.prepare(`SELECT json_group_array(json_object(${[...HISTORY_COLS, 'data'].map((c) => `'${c}', ${c}`).join(', ')})) AS j
      FROM (SELECT * FROM history WHERE time >= ?1 ORDER BY time DESC)`).bind(since).first()
    return r?.j || '[]'
  }
  const r = await db.prepare(`SELECT json_group_array(json_object(${HISTORY_COLS.map((c) => `'${c}', ${c}`).join(', ')})) AS j
    FROM (SELECT * FROM history ORDER BY time DESC LIMIT ${MAX_HISTORY})`).first()
  return r?.j || '[]'
}

/* ---------------- writing ---------------- */

/**
 * One change, all or nothing:
 * { replace?: true,                         // empty every table first (moving the data in)
 *   expect?: { table: { id: updated_at } },  // refuse if someone else changed these meanwhile
 *   put?: { table: [record…] }, del?: { table: [id…] }, settings?: [[key, value]…],
 *   history?: { id, time, who, action, summary, data }, undone?: { ids: [id…], at } }
 */
async function write(db, body, cors) {
  const stmts = []
  for (const [table, want] of Object.entries(body.expect || {})) {
    checkTable(table)
    const ids = Object.keys(want)
    if (!ids.length) continue
    const { results } = await db.prepare(`SELECT id, updated_at FROM ${table} WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)).all()
    const now = Object.fromEntries(results.map((r) => [r.id, r.updated_at]))
    for (const id of ids) {
      if ((now[id] ?? null) !== (want[id] ?? null)) {
        return new Response(JSON.stringify({ error: 'This was changed on another phone. The latest data has been loaded — please try again.', stale: true }),
          { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }
  }
  if (body.replace) for (const t of [...Object.keys(TABLES), 'settings', 'history']) stmts.push(db.prepare(`DELETE FROM ${t}`))
  for (const [table, ids] of Object.entries(body.del || {})) {
    checkTable(table)
    if (ids.length) stmts.push(db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)))
  }
  for (const [table, rows] of Object.entries(body.put || {})) {
    checkTable(table)
    if (!rows.length) continue
    const cols = TABLES[table]
    stmts.push(db.prepare(`INSERT INTO ${table} (${cols.join(', ')})
      SELECT ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?1) WHERE true
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`).bind(JSON.stringify(rows)))
  }
  if (body.settings?.length) {
    stmts.push(db.prepare(`INSERT INTO settings (key, value) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
      FROM json_each(?1) WHERE true ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(body.settings)))
  }
  if (body.undone?.ids?.length) {
    stmts.push(db.prepare('UPDATE history SET undone_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))').bind(body.undone.at, JSON.stringify(body.undone.ids)))
  }
  const h = body.history
  if (h) {
    stmts.push(db.prepare('INSERT INTO history (id, time, who, action, summary, undone_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(h.id, h.time, h.who || '', h.action || '', h.summary || '', '', h.data || '{}'))
  }
  if (stmts.length) await db.batch(stmts)
  return json(JSON.stringify({ ok: true }), cors)
}

function checkTable(t) {
  if (!TABLES[t]) throw new HttpError(400, `Unknown table ${t}`)
}
