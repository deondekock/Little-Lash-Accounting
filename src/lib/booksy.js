/**
 * Reads a Booksy notification email (subject + text) into a booking: what happened (new / cancelled /
 * moved), the client, service(s), team member, date, time and price — whatever can be found.
 * Booksy's exact wording isn't known for every email type yet, so every field is optional and the
 * raw email is kept too (it can be read again when this gets smarter).
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n) => String(n).padStart(2, '0')
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')

/** First match of several patterns (group 1), cleaned — skipping matches `ok` rejects. */
function pick(text, patterns, ok = () => true) {
  for (const re of patterns) {
    const m = text.match(re)
    if (m && clean(m[1]) && ok(clean(m[1]))) return clean(m[1])
  }
  return ''
}
// Words that start sentences in Booksy's emails but aren't a client's name.
const NOT_A_NAME = /^(appointment|booking|new|your|client|customer|the|a|an|reminder|hi|hello|dear|booksy)\b/i

/** A date in the text → 'YYYY-MM-DD' (the year guessed from when the email came if it's missing). */
export function findDate(text, received) {
  const year = Number(String(received || new Date().toISOString()).slice(0, 4))
  let m = text.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/) // 29/09/2026 (South African order)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s*(20\d\d)?/i) // 29 September 2026
  if (m) return `${m[3] || year}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d\d)?/i) // Sep 29, 2026
  if (m) return `${m[3] || year}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`
  return ''
}

/** A time in the text → 'HH:MM' (24 h). */
export function findTime(text) {
  const m = text.match(/\b(\d{1,2})[:h](\d{2})\s*([ap]\.?m\.?)?/i)
  if (!m) return ''
  let h = Number(m[1])
  const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return h < 24 ? `${pad(h)}:${m[2]}` : ''
}

export function parseBooksyEmail(subject, body, received) {
  const text = `${subject}\n${body}`
  const low = text.toLowerCase()
  const kind = /cancel/.test(low) ? 'cancelled'
    : /reschedul|has been (moved|changed)|new time|changed (the|their) (appointment|booking)/.test(low) ? 'moved'
      : /new (appointment|booking)|booked|has made (a|an) (appointment|booking)|confirmed/.test(low) ? 'new'
        : 'other'
  const client = pick(text, [
    /\b(?:client|customer)\s*(?:name)?\s*[:\-–]\s*([^\n|]+)/i,
    /\b(?:client|customer)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})/u,
    /\bfrom\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+(?:has|for)\b/u,
    /^\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+(?:has\s+)?(?:booked|cancel|reschedul|made)/mu,
  ], (name) => !NOT_A_NAME.test(name))
  const service = pick(text, [/\bservices?\s*[:\-–]\s*([^\n|]+)/i, /\btreatment\s*[:\-–]\s*([^\n|]+)/i])
  const staff = pick(text, [
    /\b(?:staff(?:\s*member)?|stylist|specialist|employee|provider|with)\s*[:\-–]\s*([^\n|]+)/i,
    /\bwith\s+([A-Z][\p{L}'-]+)\b/u,
  ])
  const priceText = pick(text, [/\b(?:price|total|amount|cost)\s*[:\-–]?\s*(?:R|ZAR)\s?([\d\s,.]+)/i, /\bR\s?(\d[\d\s,]*(?:\.\d\d)?)\b/])
  const price = priceText ? Number(priceText.replace(/[\s,]/g, '')) || null : null
  return { kind, client, service, staff, date: findDate(text, received), time: findTime(text), price }
}
