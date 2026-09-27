/**
 * Little Lash Lounge API — a Cloudflare Worker in front of the D1 database.
 *
 * Every request carries the Google sign-in token from the app. It is checked with Google.
 * The addresses in the ALLOWED_EMAILS secret are the owners and see everything; a team member
 * whose "Login Email" matches (and who is active) is staff and only ever gets her own records.
 *
 *   POST /api/session            swap a Google sign-in (1 hour) for the app's own session (60 days)
 *   GET  /api/me                 who is signed in: { role: 'admin' | 'staff', email, employeeId, name }
 * Owners:
 *   GET  /api/load               everything the app needs (all tables, settings)
 *   POST /api/write              add / change / delete records in one transaction, with a history entry
 *   GET  /api/history            recent history entries (without the stored records)
 *   GET  /api/history?since=T    entries from time T on, with their stored records (for undo)
 *   GET  /api/history?record=ID  the changes to one appointment (who, when, what it was before)
 * Staff (her own data only):
 *   GET  /api/staff/load         her team record, leave, payslips, settings, service names, and HER appointments
 *                                without amounts (she types an amount, but never sees one again)
 *   POST /api/staff/appointment  add or change one of her appointments (current / previous business month, until
 *                                her payslip for it is saved); amount only replaced when given
 *   POST /api/staff/appointment/delete   delete one she added herself, within 24 hours
 *   POST /api/staff/leave        ask for leave (or change a request that's still waiting)
 *   POST /api/staff/leave/cancel withdraw a request that's still waiting
 *   POST /api/staff/profile      change her phone number and address
 * Owners can view the app as a team member: header `X-View-As: <employeeId>` makes the request a staff
 * request for her (same data, same rules); what they do is logged as "owner (as <name>)".
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
import { TABLES, LEAVE_TYPES, STAFF_EDITABLE, METHODS, STAFF_DELETE_HOURS, MONTH_START_SETTING } from '../../src/lib/schema.js'
import { businessMonth, shiftMonth, fmt0 } from '../../src/lib/format.js'
import { notify, vapid, getConfig, setConfig, relayScript, b64url, unb64url } from './notify.js'

const HISTORY_COLS = ['id', 'time', 'who', 'action', 'summary', 'undone_at']
const MAX_HISTORY = 400

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    try {
      const url = new URL(request.url)
      if (url.pathname === '/') return text('Little Lash Lounge API', 200, cors)
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const email = await authenticate(request, env, ctx, { googleOnly: true })
        await identify(env.DB, email, env) // only people with access get a session
        return json(JSON.stringify(await issueSession(env.DB, email)), cors)
      }
      const url0 = new URL(request.url)
      // Notification settings always belong to the real person, even while viewing as someone else.
      const viewAs = url0.pathname.startsWith('/api/notify') ? '' : request.headers.get('X-View-As') || ''
      const me = await identify(env.DB, await authenticate(request, env, ctx), env, viewAs)
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
        if (route === 'POST /api/staff/appointment') return json(await staffAppointment(env.DB, me, await request.json()), cors)
        if (route === 'POST /api/staff/appointment/delete') return json(await staffDeleteAppointment(env.DB, me, await request.json()), cors)
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
      if (route === 'GET /api/history' && url.searchParams.get('record')) return json(await recordHistory(env.DB, url.searchParams.get('record')), cors)
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
async function authenticate(request, env, ctx, { googleOnly = false } = {}) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Please sign in.')
  if (token.startsWith('llp1.') && !googleOnly) return verifySession(env.DB, token)
  // Local development only (set in worker/.dev.vars, never in production): "dev:<email>" signs in as that email.
  if (env.DEV_EMAIL && token.startsWith('dev:')) return token.slice(4).toLowerCase()
  if (env.DEV_EMAIL && token === 'fake-token') return env.DEV_EMAIL
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

/* ---------------- the app's own sessions ---------------- */

// Google's sign-in token lasts an hour; the app would have to sign in again mid-use. After checking it
// once, the Worker gives the app its own signed session instead. Access is still checked on every
// request (identify), so removing someone's access takes effect at once.
const SESSION_DAYS = 60

async function sessionKey(db) {
  let secret = await getConfig(db, 'session_key')
  if (!secret) {
    secret = b64url(crypto.getRandomValues(new Uint8Array(32)))
    await setConfig(db, 'session_key', secret)
  }
  return crypto.subtle.importKey('raw', unb64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function issueSession(db, email) {
  const exp = Date.now() + SESSION_DAYS * 864e5
  const body = b64url(new TextEncoder().encode(JSON.stringify({ e: email, exp })))
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(db), new TextEncoder().encode(body))
  return { session: `llp1.${body}.${b64url(sig)}`, exp, email }
}

async function verifySession(db, token) {
  const [, body, sig] = token.split('.')
  const ok = body && sig && await crypto.subtle.verify('HMAC', await sessionKey(db), unb64url(sig), new TextEncoder().encode(body)).catch(() => false)
  if (!ok) throw new HttpError(401, 'Please sign in again.')
  const { e, exp } = JSON.parse(new TextDecoder().decode(unb64url(body)))
  if (!e || !(exp > Date.now())) throw new HttpError(401, 'Your sign-in expired. Please sign in again.')
  return String(e).toLowerCase()
}

/** Owner (ALLOWED_EMAILS), or an active team member with this login email, or nobody. */
async function identify(db, email, env, viewAs = '') {
  const owners = String(env.ALLOWED_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean)
  if (owners.includes(email)) {
    if (!viewAs) return { role: 'admin', email }
    // An owner looking at the app as this team member (for checking what she sees).
    const emp = await db.prepare(`SELECT id, name, lower(trim(json_extract(pay, '$.loginEmail'))) AS login FROM employees WHERE id = ?1`).bind(viewAs).first()
    if (!emp) throw new HttpError(404, 'That team member was not found.')
    return { role: 'staff', email: emp.login || `team-member:${emp.id}`, employeeId: emp.id, name: emp.name, actor: email }
  }
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-View-As',
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
    if (rows.some((r) => !r || typeof r.id !== 'string' || !r.id)) throw new HttpError(400, 'Every record needs an id.')
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

/** Her appointments, amount left out (NULL) so it never reaches her phone. */
const STAFF_APPT_COLS = TABLES.appointments.map((c) => (c === 'amount' ? 'NULL' : c)).join(', ')

const STAFF_PAYSLIP_COLS = TABLES.payslips.map((c) => (c === 'details' ? "json_remove(details, '$.appts', '$.inputs')" : c)).join(', ')

async function staffLoad(db, me) {
  const res = await db.batch([
    db.prepare(arraysOf('employees', 'WHERE id = ?1')).bind(me.employeeId),
    db.prepare(arraysOf('leave', 'WHERE employee_id = ?1')).bind(me.employeeId),
    // Her payslips without the owner's working (her takings and the figures typed over).
    db.prepare(`SELECT json_group_array(json_array(${STAFF_PAYSLIP_COLS})) AS j FROM payslips WHERE employee_id = ?1`).bind(me.employeeId),
    db.prepare('SELECT json_group_array(json_array(key, value)) AS j FROM settings'),
    db.prepare(`SELECT json_group_array(json_array(${STAFF_APPT_COLS})) AS j FROM appointments WHERE employee_id = ?1`).bind(me.employeeId),
    // Service names only (no prices).
    db.prepare(`SELECT json_group_array(json_array(id, name, NULL, active, NULL, created_at, updated_at)) AS j FROM services`),
  ])
  const [emps, leave, payslips, settings, appts, services] = res.map((r) => r.results[0]?.j || '[]')
  return `{"employees":${emps},"services":${services},"leave":${leave},"payslips":${payslips},"settings":${settings},"appointments":${appts}}`
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const logEntry = (db, me, action, summary, before) =>
  db.prepare('INSERT INTO history (id, time, who, action, summary, undone_at, data) VALUES (?1, ?2, ?3, ?4, ?5, \'\', ?6)')
    .bind(crypto.randomUUID(), new Date().toISOString(), me.actor ? `${me.actor} (as ${me.name})` : me.email, action, summary, JSON.stringify(before))

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

/* ---------------- staff: her own appointments ---------------- */

/** Today's date in South Africa (UTC+2). */
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)
const withoutAmount = (r) => r && { ...r, amount: null }

/** Which business months she may still change: current and previous, unless her payslip for it is saved. */
async function checkMonths(db, me, months) {
  const startDay = parseInt((await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(MONTH_START_SETTING).first())?.value, 10) || 1
  const cur = businessMonth(saToday(), startDay)
  const open = [shiftMonth(cur, -1), cur]
  for (const m of months) {
    if (!open.includes(m)) throw new HttpError(403, 'Only this month\'s and last month\'s appointments can be changed here. Ask the owner.')
    const paid = await db.prepare('SELECT 1 AS x FROM payslips WHERE employee_id = ?1 AND month = ?2').bind(me.employeeId, m).first()
    if (paid) throw new HttpError(403, 'Your payslip for that month is done, so it can\'t be changed any more. Ask the owner.')
  }
  return startDay
}

async function staffAppointment(db, me, b) {
  const date = String(b.date || '')
  if (!DATE.test(date) || date > saToday()) throw new HttpError(400, 'Please choose a valid date (not in the future).')
  const client = String(b.client || '').trim().slice(0, 80)
  const service = String(b.service || '').trim().slice(0, 200)
  if (!client) throw new HttpError(400, 'Please enter the client\'s name.')
  if (!METHODS.includes(b.method)) throw new HttpError(400, 'Please choose Cash, Card or EFT.')
  const status = b.status === 'Paid' ? 'Paid' : 'Unpaid'
  const notes = String(b.notes || '').trim().slice(0, 300)
  const overtime = String(b.overtime ?? '').toLowerCase() === 'all' ? 'All' : Number(b.overtime) > 0 && Number(b.overtime) <= 600 ? String(Math.round(Number(b.overtime))) : ''
  const length = overtime && Number(b.length) > 0 && Number(b.length) <= 720 ? Math.round(Number(b.length)) : null
  const existing = b.id ? await recordOf(db, 'appointments', 'id = ?1 AND employee_id = ?2', String(b.id), me.employeeId) : null
  if (b.id && !existing) throw new HttpError(404, 'That appointment was not found.')
  const given = b.amount !== undefined && b.amount !== null && b.amount !== ''
  const amount = given ? Math.round(Number(String(b.amount).replace(',', '.')) * 100) / 100 : existing?.amount
  if (!existing && !given) throw new HttpError(400, 'Please enter the amount.')
  if (!(amount >= 0 && amount < 1e6)) throw new HttpError(400, 'Please enter a valid amount.')
  const startDay = await checkMonths(db, me, [])
  const month = existing && existing.date === date ? existing.month : businessMonth(date, startDay)
  await checkMonths(db, me, [...new Set([month, existing?.month].filter(Boolean))])
  const now = new Date().toISOString()
  const rec = {
    id: existing?.id || crypto.randomUUID(), date, month, employee_id: me.employeeId, employee_name: me.name, client, service, amount,
    method: b.method, status, paid_on: status === 'Paid' ? (existing?.status === 'Paid' && existing.paid_on) || saToday() : '', notes, overtime, length,
    created_at: existing?.created_at || now, updated_at: now, created_by: existing ? existing.created_by : me.actor || me.email, updated_by: me.actor || me.email,
  }
  const cols = TABLES.appointments
  const what = existing
    ? [`${me.name} edited ${client} · ${ddmm(date)}`,
        existing.amount !== amount && `amount ${fmt0(existing.amount)} → ${fmt0(amount)}`,
        existing.status !== status && `${existing.status} → ${status}`,
        existing.method !== b.method && `${existing.method} → ${b.method}`].filter(Boolean).join(' · ')
    : `${me.name} added ${client} · ${fmt0(amount)} · ${b.method} · ${status} · ${ddmm(date)}`
  await db.batch([
    db.prepare(`INSERT INTO appointments (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`).bind(...cols.map((c) => rec[c] ?? null)),
    logEntry(db, me, existing ? 'edit' : 'add', what, { appts: { [rec.id]: existing || null } }),
  ])
  return JSON.stringify(withoutAmount(rec))
}

async function staffDeleteAppointment(db, me, b) {
  const existing = await recordOf(db, 'appointments', 'id = ?1 AND employee_id = ?2', String(b.id || ''), me.employeeId)
  if (!existing) throw new HttpError(404, 'That appointment was not found.')
  const fresh = Date.now() - Date.parse(existing.created_at || 0) < STAFF_DELETE_HOURS * 3600e3
  if (existing.created_by !== (me.actor || me.email) || !fresh) throw new HttpError(403, `You can only delete appointments you added in the last ${STAFF_DELETE_HOURS} hours. Ask the owner.`)
  await checkMonths(db, me, [existing.month])
  await db.batch([
    db.prepare('DELETE FROM appointments WHERE id = ?1').bind(existing.id),
    logEntry(db, me, 'delete', `${me.name} deleted ${existing.client || 'client'} · ${fmt0(existing.amount)} · ${ddmm(existing.date)}`, { appts: { [existing.id]: existing } }),
  ])
  return JSON.stringify({ ok: true })
}

/** Owners: every change to one appointment, newest first, with how it was before each change. */
async function recordHistory(db, id) {
  const r = await db.prepare(`SELECT json_group_array(json_object('id', id, 'time', time, 'who', who, 'action', action, 'summary', summary,
      'undone_at', undone_at, 'before', json_extract(data, '$.appts."' || ?1 || '"'))) AS j
    FROM (SELECT * FROM history WHERE json_valid(data) AND EXISTS (SELECT 1 FROM json_each(history.data, '$.appts') WHERE key = ?1) ORDER BY time DESC LIMIT 50)`).bind(id).first()
  return r?.j || '[]'
}
