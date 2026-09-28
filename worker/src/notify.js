/**
 * Notifications: Web Push to phones (encrypted per RFC 8291, signed with VAPID per RFC 8292) and
 * email through a small Google Apps Script "relay" deployed from the owner's Gmail.
 *
 * The push keys are made by the Worker the first time and kept in the `config` table, as are the
 * relay link and its secret. None of it is ever sent to the app (except the public push key).
 */

import { gmailCanSend, gmailSend } from './gmail.js'

const enc = new TextEncoder()
export const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

/* ---------------- settings kept on the server ---------------- */

export const getConfig = async (db, key) => (await db.prepare('SELECT value FROM config WHERE key = ?1').bind(key).first())?.value ?? null
export const setConfig = (db, key, value) =>
  db.prepare('INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run()

/** The push (VAPID) key pair, made the first time it's needed. */
export async function vapid(db) {
  const saved = await getConfig(db, 'vapid')
  if (saved) return JSON.parse(saved)
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const keys = {
    publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
  await setConfig(db, 'vapid', JSON.stringify(keys))
  return keys
}

/* ---------------- push ---------------- */

async function vapidAuth(keys, endpoint, contact) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })))
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`
}

/** Encrypts a message for one subscription (aes128gcm, one record). */
export async function encryptPush(sub, message) {
  const uaPublic = unb64url(sub.p256dh)
  const authSecret = unb64url(sub.auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256)
  const hkdf = async (salt, ikm, info, bytes) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8))
  }
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(message), new Uint8Array([2])) // 2 = last record, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain))
  const rs = new Uint8Array([0, 0, 16, 0]) // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/** Sends one push. Returns 'gone' when the phone unsubscribed (the subscription should be deleted). */
export async function sendPush(keys, sub, payload, contact) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(keys, sub.endpoint, contact),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: await encryptPush(sub, JSON.stringify(payload)),
  })
  if (res.status === 404 || res.status === 410) return 'gone'
  if (!res.ok) throw new Error(`Push failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return 'sent'
}

/* ---------------- email (Google Apps Script relay) ---------------- */

/** The Apps Script the owner pastes into script.google.com (sends mail from her Gmail). */
export const relayScript = (secret) => `// Little Lash Lounge — sends the app's notification emails from this Google account.
// Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
const SECRET = '${secret}'

function doPost(e) {
  const d = JSON.parse(e.postData.contents)
  if (d.secret !== SECRET) return ContentService.createTextOutput('no')
  MailApp.sendEmail({ to: d.to, subject: d.subject, body: d.text, htmlBody: d.html, name: 'Little Lash Lounge' })
  return ContentService.createTextOutput('ok')
}
`

export async function sendEmail(db, to, subject, text, html, env = null) {
  // The salon's connected Gmail, when there is one; else the Apps Script relay.
  if (env && (await gmailCanSend(env))) return gmailSend(env, to, subject, text, html)
  const url = await getConfig(db, 'email_relay_url')
  const secret = await getConfig(db, 'email_relay_secret')
  if (!url || !secret) return 'off'
  // Apps Script answers a POST with a redirect to the result; the mail has been sent by then.
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, to, subject, text, html }), redirect: 'manual' })
  if (res.status >= 400) throw new Error(`Email relay failed (${res.status})`)
  return 'sent'
}

/* ---------------- sending to people ---------------- */

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * Sends a notification to these people (emails): push to each of their phones, and an email
 * if they have email on. `msg` = { title, body, hash } (hash = where the app should open).
 * Never throws: a failed notification must not fail the change that caused it.
 */
export async function notify(env, emails, msg) {
  const db = env.DB
  const to = [...new Set(emails.map((e) => String(e || '').toLowerCase()).filter(Boolean))]
  if (!to.length) return []
  const results = []
  const url = `${env.APP_URL}${msg.hash ? '#' + msg.hash : ''}`
  try {
    const keys = await vapid(db)
    const contact = `mailto:${String(env.ALLOWED_EMAILS || '').split(/[,\s]+/)[0] || 'owner@example.com'}`
    const { results: subs } = await db.prepare('SELECT * FROM push_subscriptions WHERE email IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(to)).all()
    for (const sub of subs) {
      try {
        const r = await sendPush(keys, sub, { title: msg.title, body: msg.body, url, tag: msg.tag || msg.hash || 'llp' }, contact)
        if (r === 'gone') await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(sub.endpoint).run()
        results.push({ to: sub.email, via: 'push', result: r })
      } catch (err) {
        console.error('push', err)
        results.push({ to: sub.email, via: 'push', result: 'failed', error: String(err.message || err) })
      }
    }
    const { results: prefs } = await db.prepare('SELECT email, email_on FROM notify_prefs WHERE email IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(to)).all()
    const off = new Set(prefs.filter((p) => !p.email_on).map((p) => p.email))
    for (const email of to.filter((e) => !off.has(e))) {
      try {
        const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#2b1d25">
          <p style="font-size:17px;margin:0 0 8px"><b>${escape(msg.title)}</b></p><p style="margin:0 0 16px">${escape(msg.body)}</p>
          <p><a href="${escape(url)}" style="background:#b83f72;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">Open the app</a></p>
          <p style="color:#9a8791;font-size:12px">You can turn these emails off in the app: Settings → Notifications.</p></div>`
        const r = await sendEmail(db, email, msg.title, `${msg.body}\n\nOpen the app: ${url}\n\nTurn these emails off in the app: Settings → Notifications.`, html, env)
        results.push({ to: email, via: 'email', result: r })
      } catch (err) {
        console.error('email', err)
        results.push({ to: email, via: 'email', result: 'failed', error: String(err.message || err) })
      }
    }
  } catch (err) {
    console.error('notify', err)
  }
  return results
}
