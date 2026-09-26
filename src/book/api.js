/** The booking page talks to the Worker: public info and times, and (signed in) her own bookings. */
import { API_URL, FAKE_API } from '../config.js'

const KEY = 'llp.client'
export function saved() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode: she'll sign in again next time */ }
}
export const signedIn = () => { const s = saved(); return !!(s.session && s.exp > Date.now()) }
export const signOut = () => save({ email: saved().email })

export class SignInNeeded extends Error {}

async function call(path, body) {
  const s = saved()
  let res
  try {
    res = await fetch(API_URL + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(s.session ? { Authorization: 'Bearer ' + s.session } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('No internet connection. Please check it and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && path.startsWith('/api/client/') && !path.endsWith('/code') && !path.endsWith('/verify')) {
    signOut()
    throw new SignInNeeded(data.error || 'Please sign in again.')
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export const info = () => call('/api/public/info')
export const times = ({ services, who, from, days = 14, next = false }) =>
  call(`/api/public/times?services=${services.join(',')}&who=${who}&days=${days}${from ? '&from=' + from : ''}${next ? '&next=1' : ''}`)
export const sendCode = (email) => call('/api/client/code', { email })
export async function verify(email, code) {
  const r = await call('/api/client/verify', { email, code })
  save({ session: r.session, exp: r.exp, email: r.email })
  return r.client
}
export const me = () => call('/api/client/me')
export const saveProfile = (name, phone) => call('/api/client/profile', { name, phone })
export const book = (b) => call('/api/client/book', b)
export const cancel = (id) => call('/api/client/cancel', { id })
export const move = (id, date, start) => call('/api/client/move', { id, date, start })
export const notifySettings = () => call('/api/notify')
export const setEmailNotify = (emailOn) => call('/api/notify/prefs', { emailOn })
export const subscribe = (sub) => call('/api/notify/subscribe', sub)
export const unsubscribe = (endpoint) => call('/api/notify/unsubscribe', { endpoint })
export const isTesting = !!FAKE_API
