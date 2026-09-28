/**
 * The salon's Gmail account (e.g. littlelashappt@gmail.com), connected once from the app with Google's
 * own consent screen — no password is ever given to the app. The Worker keeps Google's refresh token
 * in `config` and uses the Gmail API to:
 *   - send the app's emails from that account (instead of the Apps Script relay), and
 *   - read Booksy's notification emails, so bookings show up in the app ("From Booksy").
 *
 * Needs the GOOGLE_CLIENT_SECRET secret (the same Google OAuth client as the sign-in), the Gmail API
 * enabled, and https://<worker>/api/google/callback as an authorised redirect URI.
 */
import { getConfig, setConfig, b64url, unb64url } from './notify.js'
import { parseBooksyEmail } from '../../src/lib/booksy.js'

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const enc = new TextEncoder()

export const gmailSetUp = (env) => !!(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CLIENT_ID)
const redirectUri = (origin) => `${origin}/api/google/callback`
const account = async (db) => JSON.parse((await getConfig(db, 'gmail')) || 'null')

/** The Google page to send the owner to (she picks the salon's Gmail and allows access). */
export async function connectUrl(env, origin, by) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)))
  await setConfig(env.DB, 'gmail_oauth_state', JSON.stringify({ state, by, origin, exp: Date.now() + 15 * 60000 }))
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(origin), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

/** Google sends her back here with a one-time code; swap it for tokens, then back to the app. */
export async function handleCallback(env, url) {
  const back = (result) => Response.redirect(`${env.APP_URL}#gmail-${result}`, 302)
  const saved = JSON.parse((await getConfig(env.DB, 'gmail_oauth_state')) || 'null')
  await setConfig(env.DB, 'gmail_oauth_state', '')
  if (url.searchParams.get('error')) return back('cancelled')
  if (!saved || saved.state !== url.searchParams.get('state') || saved.exp < Date.now()) return back('expired')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(saved.origin), grant_type: 'authorization_code',
    }),
  })
  const t = await res.json().catch(() => ({}))
  if (!res.ok || !t.refresh_token) {
    console.error('gmail connect', res.status, t.error, t.error_description)
    return back('failed')
  }
  const claims = JSON.parse(new TextDecoder().decode(unb64url(String(t.id_token || '').split('.')[1] || '')) || '{}')
  const scope = String(t.scope || '')
  await setConfig(env.DB, 'gmail', JSON.stringify({
    email: String(claims.email || '').toLowerCase(), refresh: t.refresh_token, scope,
    canRead: scope.includes('gmail.readonly'), canSend: scope.includes('gmail.send'), connectedAt: new Date().toISOString(), by: saved.by,
  }))
  await setConfig(env.DB, 'gmail_access', JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }))
  await setConfig(env.DB, 'gmail_error', '')
  return back('connected')
}

/** A current access token (refreshed when needed), or null when not connected / access was removed. */
async function accessToken(env) {
  const acc = await account(env.DB)
  if (!acc?.refresh || !gmailSetUp(env)) return null
  const cached = JSON.parse((await getConfig(env.DB, 'gmail_access')) || 'null')
  if (cached?.token && cached.exp > Date.now()) return cached.token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: acc.refresh, grant_type: 'refresh_token' }),
  })
  const t = await res.json().catch(() => ({}))
  if (!res.ok) {
    await setConfig(env.DB, 'gmail_error', t.error === 'invalid_grant' ? 'Google access was removed or expired. Connect Gmail again.' : `Google said: ${t.error || res.status}`)
    return null
  }
  await setConfig(env.DB, 'gmail_access', JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }))
  return t.access_token
}

async function gmail(env, path, init = {}) {
  const token = await accessToken(env)
  if (!token) throw new Error('Gmail is not connected.')
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${data.error?.message || ''}`.trim())
  return data
}

export async function gmailStatus(env) {
  const acc = await account(env.DB)
  return {
    setUp: gmailSetUp(env), connected: !!acc?.refresh, email: acc?.email || '', canRead: !!acc?.canRead, canSend: !!acc?.canSend,
    lastSync: (await getConfig(env.DB, 'booksy_last_sync')) || '', error: (await getConfig(env.DB, 'gmail_error')) || '',
  }
}

export async function disconnectGmail(env) {
  const acc = await account(env.DB)
  if (acc?.refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(acc.refresh)}`, { method: 'POST' }).catch(() => {})
  for (const k of ['gmail', 'gmail_access', 'gmail_error']) await setConfig(env.DB, k, '')
}

/** True when emails can go out through the connected Gmail. */
export async function gmailCanSend(env) {
  const acc = await account(env.DB)
  return !!(acc?.refresh && acc.canSend && gmailSetUp(env))
}

/* ---------------- sending ---------------- */

const b64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n')
const header = (s) => `=?UTF-8?B?${b64(enc.encode(s))}?=`

export async function gmailSend(env, to, subject, text, html) {
  const acc = await account(env.DB)
  const boundary = 'llp' + crypto.randomUUID().replace(/-/g, '')
  const mime = [
    `From: ${header('Little Lash Lounge')} <${acc.email}>`, `To: ${to}`, `Subject: ${header(subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(enc.encode(text))),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(enc.encode(html || text))),
    `--${boundary}--`, '',
  ].join('\r\n')
  await gmail(env, '/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(enc.encode(mime)) }) })
  return 'sent'
}

/* ---------------- reading Booksy's emails ---------------- */

const decode = (data) => new TextDecoder().decode(unb64url(data || ''))
const stripHtml = (h) => h.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()

/** The readable text of an email (plain text if there is one, else the HTML without tags). */
function bodyText(payload) {
  const parts = []
  const walk = (p) => {
    if (!p) return
    if (p.parts) p.parts.forEach(walk)
    else if (p.body?.data) parts.push({ type: p.mimeType, text: decode(p.body.data) })
  }
  walk(payload)
  const plain = parts.find((p) => p.type === 'text/plain')
  if (plain) return plain.text.trim()
  const html = parts.find((p) => p.type === 'text/html')
  return html ? stripHtml(html.text) : ''
}

/** Fetches Booksy emails from the last week that aren't stored yet. Returns how many were new. */
export async function syncBooksy(env) {
  const acc = await account(env.DB)
  if (!acc?.refresh || !acc.canRead) return 0
  const list = await gmail(env, `/messages?${new URLSearchParams({ q: 'from:booksy newer_than:7d', maxResults: '100' })}`)
  const ids = (list.messages || []).map((m) => m.id)
  let added = 0
  if (ids.length) {
    const { results } = await env.DB.prepare('SELECT id FROM booksy_emails WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).all()
    const known = new Set(results.map((r) => r.id))
    for (const id of ids.filter((x) => !known.has(x)).slice(0, 40)) {
      const m = await gmail(env, `/messages/${id}?format=full`)
      const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]))
      const received = new Date(Number(m.internalDate) || Date.now()).toISOString()
      const body = bodyText(m.payload).slice(0, 20000)
      const parsed = parseBooksyEmail(h.subject || '', body, received)
      await env.DB.prepare(`INSERT OR IGNORE INTO booksy_emails (id, received_at, subject, from_addr, body, kind, data, appointment_id, dismissed, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 0, ?8)`)
        .bind(id, received, h.subject || '', h.from || '', body, parsed.kind, JSON.stringify(parsed), new Date().toISOString()).run()
      added++
    }
  }
  await setConfig(env.DB, 'booksy_last_sync', new Date().toISOString())
  return added
}
