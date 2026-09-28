/**
 * Reads Booksy's business calendar API response into plain bookings. This is the salon's own data from
 * her own Booksy account (the same call her Booksy web calendar makes), read so bookings — including
 * ones staff move or add themselves, which never send an email — show up in the app to record.
 *
 * The response has a flat `bookings` map (each carries its own date/time, service, customer and the
 * resource/staff id) and a `resources` list that names each staff member. We keep only real client
 * bookings, not breaks or blocked time (those live under `reservations`).
 */

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** '2026-09-29T08:00' → { date:'2026-09-29', time:'08:00' }. */
function splitStamp(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' }
}

/**
 * @param json  the parsed calendar response
 * @returns array of { bookingId, uid, client, phone, service, services, staff, staffId, date, time, endTime, paid }
 */
export function parseCalendar(json) {
  if (!json || typeof json !== 'object') return []
  const staffById = new Map((json.resources || []).map((r) => [r.id, clean(r.name)]))
  const out = []
  for (const b of Object.values(json.bookings || {})) {
    if (!b || b.status === 'D' || b.status === 'X') continue // declined / deleted, just in case
    const { date, time } = splitStamp(b.booked_from)
    const end = splitStamp(b.booked_till).time
    const staffId = b.resources?.[0]?.id ?? null
    const name = clean(b.service?.name)
    out.push({
      bookingId: String(b.id),
      uid: b.appointment_uid ?? b.multibooking?.id ?? null,
      client: clean(b.customer?.name),
      phone: clean(b.customer?.phone),
      service: name,
      services: name ? [name] : [],
      staff: staffId != null ? staffById.get(staffId) || '' : '',
      staffId,
      date,
      time,
      endTime: end,
      paid: !!b.paid,
    })
  }
  // Two service blocks of one visit (same appointment_uid) → one booking with both services.
  const byUid = new Map()
  const singles = []
  for (const x of out) {
    if (x.uid == null) { singles.push(x); continue }
    const g = byUid.get(x.uid)
    if (g) {
      if (x.service && !g.services.includes(x.service)) g.services.push(x.service)
      if (x.date < g.date || (x.date === g.date && x.time < g.time)) { g.date = x.date; g.time = x.time }
      if (x.endTime > g.endTime) g.endTime = x.endTime
    } else {
      byUid.set(x.uid, { ...x })
    }
  }
  const merged = [...byUid.values(), ...singles].map((x) => ({ ...x, service: x.services.join(', ') || x.service }))
  return merged.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
}

/** The day totals Booksy shows (a sanity figure; per-booking prices aren't in this response). */
export const calendarAgenda = (json) => json?.agenda || {}
