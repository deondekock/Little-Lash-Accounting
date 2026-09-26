/**
 * Little Lash Lounge API — a Cloudflare Worker in front of the D1 database.
 *
 * Every request carries the Google sign-in token from the app. It is checked with Google.
 * The addresses in the ALLOWED_EMAILS secret are the owners and see everything; a team member
 * whose "Login Email" matches (and who is active) is staff and only ever gets her own records.
 *
 *   GET  /api/me                 who is signed in: { role: 'admin' | 'staff', email, employeeId, name }
 * Owners:
 *   GET  /api/load               everything the app needs (all tables, settings)
 *   POST /api/write              add / change / delete records in one transaction, with a history entry
 *   GET  /api/history            recent history entries (without the stored records)
 *   GET  /api/history?since=T    entries from time T on, with their stored records (for undo)
 * Staff (her own data only):
 *   GET  /api/staff/load         her team record, leave, payslips and settings (no appointments: they hold client names)
 *   POST /api/staff/leave        ask for leave (or change a request that's still waiting)
 *   POST /api/staff/leave/cancel withdraw a request that's still waiting
 *   POST /api/staff/profile      change her phone number and address
 * Everyone (her own notifications):
 *   GET  /api/notify             { emailOn, emailReady, vapidKey }
 *   POST /api/notify/prefs       { emailOn }
 *   POST /api/notify/subscribe   a phone's push subscription;  POST /api/notify/unsubscribe { endpoint }
 *   POST /api/notify/test        sends a test notification to yourself
 * Owners: GET/POST /api/notify/email   the Gmail relay (Apps Script) link and script
 *
 * Owners are told when staff ask for, change or withdraw leave, or change their details; staff when
 * the owner approves/declines their leave or saves a new payslip (sent with /api/write as `notify`).
 *
 * Every night a copy of the whole database goes into the BACKUPS KV store (kept 35 days).
 * The Worker hardly parses anything: SQLite builds the JSON, so big loads stay cheap.
 */
import { TABLES, LEAVE_TYPES, STAFF_EDITABLE } from '../../src/lib/schema.js'
import { notify, vapid, getConfig, setConfig, relayScript } from './notify.js'

const HISTORY_COLS = ['id', 'time', 'who', 'action', 'summary', 'undone_at']
const MAX_HISTORY = 400

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      const url = new URL(request.url)
      if (url.pathname === '/') return text('Little Lash Lounge API', 200, cors)
      const me = await identify(env.DB, await authenticate(request, env, ctx), env)
      const route = `${request.method} ${url.pathname}`
      // Notifications go out after the answer, so they never slow down or fail a change.
      const tell = (emails, msg) => ctx.waitUntil(notify(env, emails, msg))
      const owners = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean)
      if (route === 'GET /api/me') return json(JSON.stringify(me), cors)
      if (url.pathname.startsWith('/api/notify')) return json(await notifyRoute(env, me, route, request), cors)
      if (me.role === 'staff') {
        if (route === 'GET /api/staff/load') return json(await staffLoad(env.DB, me), cors)
        if (route === 'POST /api/staff/leave') return json(await staffLeave(env.DB, me, await request.json(), (m) => tell(owners, m)), cors)
        if (route === 'POST /api/staff/leave/cancel') return json(await staffCancel(env.DB, me, await request.json(), (m) => tell(owners, m)), cors)
        if (route === 'POST /api/staff/profile') return json(await staffProfile(env.DB, me, await request.json(), (m) => tell(owners, m)), cors)
        throw new HttpError(403, 'Only the owner can do that.')
      }
      if (route === 'GET /api/load') return json(await loadAll(env.DB), cors)
      if (route === 'POST /api/write') {
        const body = await request.json()
        const res = await write(env.DB, body, cors)
        if (res.ok && body.notify?.length) ctx.waitUntil(notifyStaff(env, body.notify))
        return res
      }
      if (route === 'GET /api/history') return json(await history(env.DB, url.searchParams.get('since')), cors)
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

/** Checks the Google access token (cached for a few minutes); returns the verified email. */
async function authenticate(request, env, ctx) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Please sign in.')
  // Local development only (set in worker/.dev.vars, never in production): "dev:<email>" signs in as that email.
  if (env.DEV_EMAIL) return token.startsWith('dev:') ? token.slice(4).toLowerCase() : env.DEV_EMAIL
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
  if (!email || String(info.email_verified) !== 'true') throw new HttpError(403, 'This Google account has no verified email address.')
  return email
}

/** Owner (ALLOWED_EMAILS), or an active team member with this login email, or nobody. */
async function identify(db, email, env) {
  const owners = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean)
  if (owners.includes(email)) return { role: 'admin', email }
  const emp = await db.prepare(`SELECT id, name FROM employees
    WHERE active = 1 AND lower(trim(json_extract(pay, '$.loginEmail'))) = ?1 LIMIT 1`).bind(email).first()
  if (emp) return { role: 'staff', email, employeeId: emp.id, name: emp.name }
  throw new HttpError(403, `${email} doesn't have access to the salon's app. Ask the owner to add it to your team profile.`)
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

/* ---------------- staff: her own data only ---------------- */

const cols = (t) => TABLES[t].join(', ')
const recordOf = (db, table, where, ...args) => db.prepare(`SELECT ${cols(table)} FROM ${table} WHERE ${where}`).bind(...args).first()

async function staffLoad(db, me) {
  const res = await db.batch([
    db.prepare(arraysOf('employees', 'WHERE id = ?1')).bind(me.employeeId),
    db.prepare(arraysOf('leave', 'WHERE employee_id = ?1')).bind(me.employeeId),
    db.prepare(arraysOf('payslips', 'WHERE employee_id = ?1')).bind(me.employeeId),
    db.prepare('SELECT json_group_array(json_array(key, value)) AS j FROM settings'),
  ])
  const [emps, leave, payslips, settings] = res.map((r) => r.results[0]?.j || '[]')
  return `{"employees":${emps},"services":[],"leave":${leave},"payslips":${payslips},"settings":${settings},"appointments":[]}`
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const logEntry = (db, me, action, summary, before) =>
  db.prepare('INSERT INTO history (id, time, who, action, summary, undone_at, data) VALUES (?1, ?2, ?3, ?4, ?5, \'\', ?6)')
    .bind(crypto.randomUUID(), new Date().toISOString(), me.email, action, summary, JSON.stringify(before))

/** A leave request from her (new, or a change to one that's still waiting). Always 'requested'. */
async function staffLeave(db, me, body, tell) {
  const type = LEAVE_TYPES.includes(body.type) ? body.type : null
  const from = String(body.from || '')
  const to = String(body.to || from)
  const hours = Math.round(Number(body.hours) * 100) / 100
  const notes = String(body.notes || '').trim().slice(0, 500)
  if (!type) throw new HttpError(400, 'Please choose the type of leave.')
  if (!DATE.test(from) || !DATE.test(to) || to < from) throw new HttpError(400, 'Please choose valid dates.')
  if (!(hours > 0 && hours <= 2000)) throw new HttpError(400, 'Please enter the hours of leave.')
  const existing = body.id ? await recordOf(db, 'leave', 'id = ?1 AND employee_id = ?2', body.id, me.employeeId) : null
  if (body.id && !existing) throw new HttpError(404, 'That leave request was not found.')
  if (existing && existing.status !== 'requested') throw new HttpError(403, 'Only requests that are still waiting can be changed.')
  const now = new Date().toISOString()
  const id = existing?.id || crypto.randomUUID()
  await db.batch([
    db.prepare(`INSERT INTO leave (${cols('leave')}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'requested')
      ON CONFLICT(id) DO UPDATE SET type = excluded.type, from_date = excluded.from_date, to_date = excluded.to_date,
      hours = excluded.hours, notes = excluded.notes, updated_at = excluded.updated_at`)
      .bind(id, me.employeeId, me.name, type, from, to, hours, notes, existing?.created_at || now, now),
    logEntry(db, me, 'leave', `${me.name} ${existing ? `changed her ${type.toLowerCase()} leave request` : `asked for ${type.toLowerCase()} leave`} · ${ddmm(from)}${to !== from ? '–' + ddmm(to) : ''} · ${hours} h`,
      { leave: { [id]: existing || null } }),
  ])
  tell({
    title: `🌴 ${me.name} ${existing ? 'changed her leave request' : 'asked for leave'}`,
    body: `${type} · ${ddmm(from)}${to !== from ? '–' + ddmm(to) : ''} · ${hours} h${notes ? ` · “${notes}”` : ''}`,
    hash: 'leave', tag: `leave-${id}`,
  })
  return JSON.stringify(await recordOf(db, 'leave', 'id = ?1', id))
}

async function staffCancel(db, me, body, tell) {
  const existing = await recordOf(db, 'leave', 'id = ?1 AND employee_id = ?2', String(body.id || ''), me.employeeId)
  if (!existing) throw new HttpError(404, 'That leave request was not found.')
  if (existing.status !== 'requested') throw new HttpError(403, 'Only requests that are still waiting can be withdrawn.')
  await db.batch([
    db.prepare('DELETE FROM leave WHERE id = ?1').bind(existing.id),
    logEntry(db, me, 'leave', `${me.name} withdrew a ${String(existing.type).toLowerCase()} leave request · ${ddmm(existing.from_date)}`, { leave: { [existing.id]: existing } }),
  ])
  tell({ title: `${me.name} withdrew a leave request`, body: `${existing.type} · ${ddmm(existing.from_date)}${existing.to_date !== existing.from_date ? '–' + ddmm(existing.to_date) : ''}`, hash: 'leave', tag: `leave-${existing.id}` })
  return JSON.stringify({ ok: true })
}

/** She can change her phone number and address (nothing else about her record). */
async function staffProfile(db, me, body, tell) {
  const emp = await recordOf(db, 'employees', 'id = ?1', me.employeeId)
  let pay = {}
  try { pay = JSON.parse(emp.pay || '{}') } catch { pay = {} }
  const phone = STAFF_EDITABLE.includes('phone') && body.phone !== undefined ? String(body.phone).trim().slice(0, 40) : emp.phone
  const address = STAFF_EDITABLE.includes('address') && body.address !== undefined ? String(body.address).replace(/\r/g, '').trim().slice(0, 300) : pay.address
  if (phone === (emp.phone || '') && address === (pay.address || '')) return JSON.stringify(emp)
  const now = new Date().toISOString()
  const changed = [phone !== (emp.phone || '') && 'phone number', address !== (pay.address || '') && 'address'].filter(Boolean).join(' and ')
  await db.batch([
    db.prepare('UPDATE employees SET phone = ?1, pay = ?2, updated_at = ?3 WHERE id = ?4').bind(phone, JSON.stringify({ ...pay, address }), now, emp.id),
    logEntry(db, me, 'team', `${me.name} updated her ${changed}`, { emps: { [emp.id]: emp } }),
  ])
  tell({ title: `${me.name} updated her ${changed}`, body: [phone !== (emp.phone || '') && `Phone: ${phone || '—'}`, address !== (pay.address || '') && `Address: ${address.replace(/\n/g, ', ') || '—'}`].filter(Boolean).join(' · '), hash: 'team' })
  return JSON.stringify(await recordOf(db, 'employees', 'id = ?1', emp.id))
}

/* ---------------- notifications ---------------- */

/** Owner's changes that concern a staff member (e.g. leave approved) → her login email. */
async function notifyStaff(env, list) {
  for (const n of list.slice(0, 20)) {
    const emp = await env.DB.prepare(`SELECT lower(trim(json_extract(pay, '$.loginEmail'))) AS email FROM employees WHERE id = ?1 AND active = 1`).bind(String(n.employeeId || '')).first()
    if (emp?.email) await notify(env, [emp.email], { title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 300), hash: String(n.hash || ''), tag: n.tag })
  }
}

async function notifyRoute(env, me, route, request) {
  const db = env.DB
  const relayReady = async () => !!((await getConfig(db, 'email_relay_url')) && (await getConfig(db, 'email_relay_secret')))
  if (route === 'GET /api/notify') {
    const pref = await db.prepare('SELECT email_on FROM notify_prefs WHERE email = ?1').bind(me.email).first()
    return JSON.stringify({ emailOn: pref ? !!pref.email_on : true, emailReady: await relayReady(), vapidKey: (await vapid(db)).publicKey })
  }
  if (route === 'POST /api/notify/prefs') {
    const body = await request.json()
    await db.prepare('INSERT INTO notify_prefs (email, email_on, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET email_on = excluded.email_on, updated_at = excluded.updated_at')
      .bind(me.email, body.emailOn ? 1 : 0, new Date().toISOString()).run()
    return JSON.stringify({ ok: true })
  }
  if (route === 'POST /api/notify/subscribe') {
    const sub = await request.json()
    const local = env.DEV_EMAIL && /^http:\/\/127\.0\.0\.1:\d+\//.test(sub?.endpoint || '') // local testing only
    if ((!/^https:\/\//.test(sub?.endpoint || '') && !local) || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'Invalid push subscription.')
    await db.prepare(`INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(endpoint) DO UPDATE SET email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth`)
      .bind(sub.endpoint, me.email, sub.keys.p256dh, sub.keys.auth, new Date().toISOString()).run()
    return JSON.stringify({ ok: true })
  }
  if (route === 'POST /api/notify/unsubscribe') {
    const { endpoint } = await request.json()
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1 AND email = ?2').bind(String(endpoint || ''), me.email).run()
    return JSON.stringify({ ok: true })
  }
  if (route === 'POST /api/notify/test') {
    const results = await notify(env, [me.email], { title: '✨ Test from Little Lash Lounge', body: 'Notifications are working.', hash: '', tag: 'test' })
    return JSON.stringify({ results })
  }
  if (me.role !== 'admin') throw new HttpError(403, 'Only the owner can do that.')
  if (route === 'GET /api/notify/email') {
    let secret = await getConfig(db, 'email_relay_secret')
    if (!secret) {
      secret = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
      await setConfig(db, 'email_relay_secret', secret)
    }
    return JSON.stringify({ url: (await getConfig(db, 'email_relay_url')) || '', script: relayScript(secret) })
  }
  if (route === 'POST /api/notify/email') {
    const { url } = await request.json()
    const u = String(url || '').trim()
    const local = env.DEV_EMAIL && /^http:\/\/127\.0\.0\.1:\d+\//.test(u) // local testing only
    if (u && !local && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) throw new HttpError(400, 'That should be the Web app link from Apps Script, ending in /exec.')
    await setConfig(db, 'email_relay_url', u)
    return JSON.stringify({ ok: true })
  }
  throw new HttpError(404, 'Not found')
}
