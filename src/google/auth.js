/**
 * Google sign-in using the OAuth 2.0 redirect ("implicit") flow, so it works
 * the same in a browser tab and in an installed PWA — no popups, no server.
 * The access token lives about an hour. On Cloudflare the app swaps it straight away for the
 * server's own session (60 days), so nobody is sent back to sign in mid-use. Without a session,
 * we silently get a new Google token with prompt=none (no screen if still signed in to Google).
 */
import { CLIENT_ID, FAKE_API, BACKEND } from '../config.js'

// On Cloudflare the app only needs to know who you are (no access to your Google files).
const SCOPES = (BACKEND === 'cloudflare'
  ? ['openid', 'https://www.googleapis.com/auth/userinfo.email']
  : ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email']).join(' ')
const KEY = 'llp.auth'
const STATE_KEY = 'llp.oauthState'
const SILENT_KEY = 'llp.silentTried'

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function write(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode): sign-in will simply be asked again
  }
}

function session(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key)
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    return null
  }
}

const redirectUri = () => location.origin + import.meta.env.BASE_URL

/** Reads the token Google sends back in the URL (#access_token=…). Returns null, { ok } or { error }. */
export function handleRedirect() {
  const hash = location.hash.slice(1)
  if (!/(^|&)(access_token|error)=/.test(hash)) return null
  const p = new URLSearchParams(hash)
  history.replaceState(null, '', location.pathname + location.search)
  if (p.get('state') !== session(STATE_KEY)) return { error: 'state_mismatch' }
  session(STATE_KEY, null)
  if (p.get('error')) return { error: p.get('error') }
  // A new sign-in replaces any session from before (it may be a different account).
  write({ ...read(), token: p.get('access_token'), expiresAt: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000, session: null, sessionExp: 0 })
  session(SILENT_KEY, null)
  return { ok: true }
}

/** The Google access token if still valid, or null. */
export function googleToken() {
  const a = read()
  return a.token && a.expiresAt - 60_000 > Date.now() ? a.token : null
}

/** The app's own session (Cloudflare) if still valid, or null. */
export function sessionToken() {
  const a = read()
  return a.session && a.sessionExp - 3600_000 > Date.now() ? a.session : null
}

export const clearSession = () => write({ ...read(), session: null, sessionExp: 0 })

export function saveSession({ session, exp, email }) {
  write({ ...read(), session, sessionExp: exp, ...(email ? { email } : {}) })
}

/** What to send with requests: the app's session, else the Google token, or null. */
export function getToken() {
  // Testing: ?as=<email> signs in as that person (the local Worker accepts "dev:<email>").
  if (FAKE_API) return new URLSearchParams(location.search).get('as') ? 'dev:' + new URLSearchParams(location.search).get('as') : 'fake-token'
  return sessionToken() || googleToken()
}

export const knownEmail = () => (FAKE_API ? new URLSearchParams(location.search).get('as') || 'test@example.com' : read().email || '')

export function rememberEmail(email) {
  write({ ...read(), email })
}

/** The last known role ('admin' | 'staff'), for an optimistic instant start before whoami confirms it. */
export const knownRole = () => read().role || ''
export function rememberRole(role) {
  write({ ...read(), role })
}

/** Silent sign-in is attempted at most once per tab, to avoid redirect loops. */
export const canTrySilent = () => !!knownEmail() && !session(SILENT_KEY)

/** Sends the browser to Google's sign-in page; it comes back to this app. */
export function signIn({ silent = false } = {}) {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  session(STATE_KEY, state)
  if (silent) session(SILENT_KEY, '1')
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    state,
  })
  const email = knownEmail()
  if (email) params.set('login_hint', email)
  if (silent) params.set('prompt', 'none')
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params)
}

export function signOut() {
  const { token } = read()
  if (token) {
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => {})
  }
  write({})
}

/** The signed-in Google account's email address. */
export async function fetchEmail() {
  if (FAKE_API) return knownEmail()
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + googleToken() },
  })
  if (!res.ok) return ''
  const { email = '' } = await res.json()
  if (email) rememberEmail(email)
  return email
}
