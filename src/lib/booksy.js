/**
 * Reads a Booksy notification email (subject + text) into a booking: what happened (new / cancelled /
 * moved), the client and her cell number, service(s), team member, date, time and price.
 *
 * Booksy's booking email looks like this (subject, then the text of the email):
 *   Deon De Kock: new booking Monday, 28 September 2026 10:00
 *   Deon De Kock
 *   063 764 0016
 *   Monday, 28 September 2026, 10:00 - 11:00
 *   Lash Extensions with Chrisilda: 2 Week Classic Lash Fill
 *   R365,00, 10:00 - 11:00
 *   with Chrisilda de Kock
 * (one service block per service). Every field is optional; looser patterns catch other wordings.
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

// A rand amount: R365,00 · R1 365,00 · R1,365.00 · R 365
const MONEY = /\bR\s?(\d{1,3}(?:[  .,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)/
/** '1 365,00' / '1,365.00' / '365' → 1365 / 365. */
export function randAmount(s) {
  const t = String(s).replace(/[  ]/g, '')
  const dec = t.match(/[.,](\d{1,2})$/)
  const whole = (dec ? t.slice(0, -dec[0].length) : t).replace(/[.,]/g, '')
  const n = Number(`${whole}${dec ? `.${dec[1]}` : ''}`)
  return Number.isFinite(n) ? n : null
}

/** A South African cell / phone number, as written in the email. */
const PHONE = /(?:\+27|\b0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/

/** Booksy's service blocks: "<Category> with <Name>: <Service>" then "R365,00, 10:00 - 11:00" then "with <Name>". */
function serviceBlocks(lines) {
  const out = []
  lines.forEach((line, i) => {
    const m = line.match(new RegExp(`^${MONEY.source}\\s*,?\\s*(\\d{1,2}[:h]\\d{2})?`))
    if (!m || i === 0) return
    let name = lines[i - 1]
    if (MONEY.test(name) || /^with\s/i.test(name)) return
    // "Lash Extensions with Chrisilda: 2 Week Classic Lash Fill" → "2 Week Classic Lash Fill"
    const colon = name.lastIndexOf(':')
    if (colon > 0 && colon < name.length - 1) name = name.slice(colon + 1)
    const staff = (lines[i + 1] || '').match(/^with\s+(.+)$/i)?.[1] || (lines[i - 1].match(/\bwith\s+([^:]+):/i)?.[1] ?? '')
    out.push({ name: clean(name), price: randAmount(m[1]), time: m[2] ? findTime(m[2]) : '', staff: clean(staff) })
  })
  return out
}

export function parseBooksyEmail(subject, body, received) {
  const text = `${subject}\n${body}`
  const lines = String(body || '').split(/\n+/).map(clean).filter(Boolean)
  const kindOf = (s) => {
    const low = s.toLowerCase()
    return /cancel/.test(low) ? 'cancelled'
      : /reschedul|has been (moved|changed)|new time|booking (changed|moved|updated)|changed (the|their) (appointment|booking)/.test(low) ? 'moved'
        : /new (appointment|booking)|booked|has made (a|an) (appointment|booking)|confirmed/.test(low) ? 'new'
          : ''
  }
  // The subject says it best ("Name: new booking …"); the text only when the subject doesn't.
  const kind = kindOf(subject) || kindOf(body) || 'other'

  const client = pick(text, [
    /^\s*([^:\n]{2,60}?):\s*(?:new booking|booking|appointment|cancel|reschedul)/im, // Booksy's "Deon De Kock: new booking …"
    /\b(?:client|customer)\s*(?:name)?\s*[:\-–]\s*([^\n|]+)/i,
    /\b(?:client|customer)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})/u,
    /\bfrom\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+(?:has|for)\b/u,
    /^\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})\s+(?:has\s+)?(?:booked|cancel|reschedul|made)/mu,
  ], (name) => !NOT_A_NAME.test(name))
  const phone = (body.match(PHONE)?.[0] || '').replace(/\s+/g, ' ').trim()

  const blocks = serviceBlocks(lines)
  const service = blocks.length ? blocks.map((b) => b.name).join(', ')
    : pick(text, [/\bservices?\s*[:\-–]\s*([^\n|]+)/i, /\btreatment\s*[:\-–]\s*([^\n|]+)/i])
  const staff = blocks.find((b) => b.staff)?.staff || pick(text, [
    /\b(?:staff(?:\s*member)?|stylist|specialist|employee|provider)\s*[:\-–]\s*([^\n|]+)/i,
    /^with\s+(.+)$/im,
    /\bwith\s+([A-Z][\p{L}'-]+)\b/u,
  ])
  let price = null
  if (blocks.length && blocks.every((b) => b.price != null)) price = Math.round(blocks.reduce((s, b) => s + b.price, 0) * 100) / 100
  else {
    const m = text.match(new RegExp(`\\b(?:price|total|amount|cost)\\s*[:\\-–]?\\s*${MONEY.source.slice(2)}`, 'i')) || text.match(MONEY)
    if (m) price = randAmount(m[1])
  }
  return { kind, client, phone, service, services: blocks.map((b) => b.name), staff, date: findDate(text, received), time: findTime(text), price }
}
