/**
 * Reads the salon's own Booksy business calendar directly from Booksy's API — the same request her
 * Booksy web calendar makes — so every booking shows up in the app to record, including ones staff
 * move or add themselves (those never send an email). This is her own account and her own data.
 *
 * Set up once from the app (Settings → Booksy & Gmail): the owner pastes her Booksy access token, the
 * frontdesk API key and the business id, captured from her signed-in Booksy calendar. Those are kept
 * in `config` (never in the code) and sent as the X-Access-Token / X-Api-Key headers. If Booksy signs
 * the token out, the sync stops and the app shows "reconnect" — the email sync stays as the fallback.
 *
 * Bookings are stored in the same `booksy_emails` table the email sync uses (id `cal-<bookingId>`), so
 * the whole "From Booksy" screen works unchanged. Each sync updates changed bookings in place and marks
 * ones that vanished from the calendar (cancellations) — but never touches ones already recorded.
 */
import { getConfig, setConfig } from './notify.js'
import { parseCalendar } from '../../src/lib/booksyCal.js'

const HOST = 'za.booksy.com'
const cfg = async (db) => JSON.parse((await getConfig(db, 'booksy_api')) || 'null')

export const booksyApiSetUp = async (db) => {
  const c = await cfg(db)
  return !!(c?.token && c?.apiKey && c?.businessId)
}

/** Store / clear the Booksy connection (owner pastes token, apiKey, businessId). */
export async function connectBooksyApi(env, { token, apiKey, businessId, by }) {
  token = String(token || '').trim()
  apiKey = String(apiKey || '').trim()
  businessId = String(businessId || '').trim().replace(/\D/g, '')
  if (!token || !apiKey || !businessId) throw new Error('Need the access token, API key and business id.')
  // Check it works before saving, so a wrong paste fails loudly instead of silently.
  const test = await callCalendar({ token, apiKey, businessId }, today(), today())
  if (!test.ok) throw new Error(test.error || 'Booksy did not accept those details.')
  await setConfig(env.DB, 'booksy_api', JSON.stringify({ token, apiKey, businessId, connectedAt: new Date().toISOString(), by }))
  await setConfig(env.DB, 'booksy_error', '')
  return { ok: true }
}

export async function disconnectBooksyApi(env) {
  await setConfig(env.DB, 'booksy_api', '')
  await setConfig(env.DB, 'booksy_error', '')
}

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/** One calendar request for a date range. Returns { ok, json?, status?, error? }. */
async function callCalendar({ token, apiKey, businessId }, startDate, endDate) {
  const url = `https://${HOST}/core/v2/business_api/me/businesses/${businessId}/calendar`
    + `?start_date=${startDate}&end_date=${endDate}&include_unconfirmed=true&version=3&resources_per_page=50`
  let res
  try {
    res = await fetch(url, { headers: { 'X-Access-Token': token, 'X-Api-Key': apiKey, 'X-App-Version': '3.0', 'Accept': 'application/json' } })
  } catch (err) {
    return { ok: false, error: `Could not reach Booksy: ${err.message || err}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'Booksy sign-in expired — please reconnect.' }
  if (!res.ok) return { ok: false, status: res.status, error: `Booksy replied ${res.status}.` }
  try {
    return { ok: true, json: await res.json() }
  } catch {
    return { ok: false, error: 'Booksy sent something unexpected.' }
  }
}

/**
 * Fetch the calendar window, put its bookings into `booksy_emails`, and mark cancellations.
 * Window: yesterday .. +13 days (covers "record after today's visit" plus upcoming changes).
 * Returns the number of bookings seen, or throws on a connection problem.
 */
export async function syncBooksyCalendar(env) {
  const c = await cfg(env.DB)
  if (!c?.token) return 0
  const start = addDays(today(), -1)
  const end = addDays(today(), 13)
  const r = await callCalendar(c, start, end)
  if (!r.ok) {
    await setConfig(env.DB, 'booksy_error', r.error || 'Booksy sync failed.')
    throw new Error(r.error || 'Booksy sync failed')
  }
  await setConfig(env.DB, 'booksy_error', '')
  const bookings = parseCalendar(r.json)
  const now = new Date().toISOString()
  const seen = new Set()
  for (const b of bookings) {
    if (!b.date) continue
    const id = `cal-${b.bookingId}`
    seen.add(id)
    const receivedAt = `${b.date}T${b.time || '00:00'}`
    const subject = `${b.client || 'Booking'}: ${b.service || 'appointment'} ${b.date} ${b.time}`.trim()
    const data = JSON.stringify({ client: b.client, phone: b.phone, service: b.service, services: b.services, staff: b.staff, date: b.date, time: b.time, price: null, paid: b.paid })
    // Insert new, or refresh a still-pending one in place (time/service/staff may have changed).
    // Never touch one already recorded (appointment_id set) or dismissed by the owner.
    await env.DB.prepare(`INSERT INTO booksy_emails (id, received_at, subject, from_addr, body, kind, data, appointment_id, dismissed, created_at)
      VALUES (?1, ?2, ?3, 'booksy-calendar', '', 'new', ?4, NULL, 0, ?5)
      ON CONFLICT(id) DO UPDATE SET received_at = ?2, subject = ?3, data = ?4, kind = 'new'
      WHERE booksy_emails.appointment_id IS NULL AND booksy_emails.dismissed = 0`)
      .bind(id, receivedAt, subject, data, now).run()
  }
  // Anything we had for this window that's gone from the calendar was cancelled — drop it from the
  // to-do list (unless already recorded or dismissed). Compared in JS: the set is small.
  const { results } = await env.DB.prepare(
    `SELECT id, data FROM booksy_emails WHERE id LIKE 'cal-%' AND kind = 'new' AND appointment_id IS NULL AND dismissed = 0`,
  ).all()
  for (const row of results || []) {
    if (seen.has(row.id)) continue
    let date = ''
    try { date = JSON.parse(row.data || '{}').date || '' } catch { /* ignore */ }
    if (date >= start && date <= end) {
      await env.DB.prepare("UPDATE booksy_emails SET kind = 'cancelled' WHERE id = ?1").bind(row.id).run()
    }
  }
  await setConfig(env.DB, 'booksy_last_sync', now)
  return bookings.length
}

export async function booksyApiStatus(env) {
  const c = await cfg(env.DB)
  return {
    connected: !!c?.token,
    businessId: c?.businessId || '',
    connectedAt: c?.connectedAt || '',
    lastSync: (await getConfig(env.DB, 'booksy_last_sync')) || '',
    error: (await getConfig(env.DB, 'booksy_error')) || '',
  }
}
