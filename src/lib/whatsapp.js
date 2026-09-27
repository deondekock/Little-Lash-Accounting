/**
 * WhatsApp nudges: opens WhatsApp with a friendly message ready to send (free — nothing is sent
 * automatically). With a saved cell number it opens her chat; without one WhatsApp asks who to send it to.
 */
import { fmt0, shortDate } from './format.js'

/** South African numbers: 082 123 4567 / +27 82 123 4567 → 27821234567. */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('0')) d = '27' + d.slice(1)
  return d.length >= 11 ? d : ''
}

export const waLink = (phone, text) => {
  const n = waNumber(phone)
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'
const sign = (from) => (from ? `\n\n${from} · Little Lash Lounge` : '\n\nLittle Lash Lounge')
const weeksSince = (days) => Math.max(1, Math.round(days / 7))

export const MESSAGES = {
  refill: (c, from) =>
    `Hi ${first(c.name)}! 💕 It's been about ${weeksSince(c.daysSince)} weeks since your last visit, so your lashes are probably ready for a fill. ` +
    `Would you like me to book you in?${sign(from)}`,
  quiet: (c, from) =>
    `Hi ${first(c.name)}! We miss you at Little Lash Lounge 💕 It's been a while since we last saw you. ` +
    `Would you like to come in for a little pamper? Just reply and I'll find you a time.${sign(from)}`,
  owed: (c, from) => {
    const unpaid = c.history.filter((v) => v.status !== 'Paid')
    const when = unpaid.length === 1 ? ` from your visit on ${shortDate(unpaid[0].date)}` : ''
    return `Hi ${first(c.name)}, hope you're well! 😊 Just a friendly reminder that ${fmt0(c.unpaid)} is still outstanding${when}. ` +
      `You're welcome to pay by EFT or at your next visit. Thank you!${sign(from)}`
  },
  hello: (c, from) => `Hi ${first(c.name)}!${sign(from)}`,
}

/** Opens WhatsApp with the message (a new tab on computers, the WhatsApp app on phones). */
export function openWhatsApp(phone, text) {
  window.open(waLink(phone, text), '_blank', 'noopener')
}
