/** Minimal Google Sheets API v4 client (fetch + the signed-in user's token). */
import { SHEETS_BASE } from '../config.js'
import { getToken } from './auth.js'

export class AuthError extends Error {}

export async function sheetsApi(path, { method = 'GET', query = {}, body } = {}) {
  const token = getToken()
  if (!token) throw new AuthError('Please sign in with Google again.')
  const url = new URL(SHEETS_BASE + path)
  for (const [k, v] of Object.entries(query)) {
    for (const item of [].concat(v)) url.searchParams.append(k, item)
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new AuthError('Your Google sign-in expired. Please sign in again.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data.error?.message || `Google Sheets error ${res.status}`
    throw new Error(res.status === 403 || res.status === 404
      ? `Can't open the Google Sheet (${msg}). Is it shared with this Google account?`
      : msg)
  }
  return data
}

export const range = (sheet, a1) => `'${sheet}'!${a1}`
export const enc = encodeURIComponent

/** Sheet ID from a full Google Sheets link, or the ID itself. */
export function parseSheetId(input) {
  const s = String(input || '').trim()
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : /^[a-zA-Z0-9_-]+$/.test(s) ? s : ''
}
