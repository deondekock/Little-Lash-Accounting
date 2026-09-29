/**
 * A statement of a client's unpaid visits, drawn as a PNG image (for WhatsApp), with the logo, the
 * visits, the amount due and how to pay. Drawn on a canvas in the salon's fonts — nothing leaves the phone.
 */
import { fmt, todayStr } from './format.js'
import { clientKey } from './stats.js'

const W = 1080
const PAD = 72
const INK = '#33292b'
const MUTED = '#8a7d7e'
const ROSE = '#a0555c'
const BLUSH = '#f8e6e4'
const LINE = '#eee3e2'
const SERIF = '"Libre Baskerville", Georgia, serif'
const SANS = '"Jost Variable", "Helvetica Neue", Arial, sans-serif'

const longDate = (d) => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDay = (d) => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

/** "LLL-20260927-LISA": the date and her name, so the same statement always gets the same number that day. */
export function invoiceNumber(client, date = todayStr()) {
  const name = clientKey(client.name).replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase() || 'CLIENT'
  return `LLL-${date.replace(/-/g, '')}-${name}`
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Cuts text to fit a width, with an ellipsis. */
function fit(ctx, text, width) {
  let t = String(text || '')
  if (ctx.measureText(t).width <= width) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
  return t + '…'
}

/**
 * @param client  { name, history: [appointments] } (unpaid ones are listed)
 * @param company the salon's details (name, address, phone, email, bank…)
 * @param nameOf  employee id → name
 * @returns Promise<Blob> (PNG)
 */
export async function invoiceImage(client, company = {}, nameOf = () => '') {
  const owing = (v) => (v.outstanding != null ? v.outstanding : (v.status === 'Unpaid' ? v.amount : 0))
  const visits = client.history.filter((v) => owing(v) > 0.005).sort((a, b) => (a.date < b.date ? -1 : 1))
  const total = visits.reduce((s, v) => s + owing(v), 0)
  await Promise.all([document.fonts?.load(`40px ${SERIF}`), document.fonts?.load(`400 30px ${SANS}`), document.fonts?.load(`600 30px ${SANS}`)].map((p) => p?.catch?.(() => {})))
  const logo = await loadImage(import.meta.env.BASE_URL + 'brand/logo.png')

  const ROW = 64
  const bank = [company.bank && `Bank: ${company.bank}`, company.bankHolder && `Account name: ${company.bankHolder}`,
    company.bankAccount && `Account number: ${company.bankAccount}`, company.bankBranch && `Branch code: ${company.bankBranch}`].filter(Boolean)
  const H = 1400 + visits.length * ROW + bank.length * 44 // generous; cut to size at the end
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)

  // Header: blush band with the logo.
  const g = ctx.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, '#fbf1ef')
  g.addColorStop(1, '#f1d2d1')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, 300)
  if (logo) {
    const lw = 620
    const lh = (logo.height / logo.width) * lw
    ctx.drawImage(logo, (W - lw) / 2, (300 - lh) / 2, lw, lh)
  } else {
    ctx.fillStyle = ROSE
    ctx.font = `64px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.fillText('Little Lash Lounge', W / 2, 170)
  }

  // Title and details.
  let y = 400
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `56px ${SERIF}`
  ctx.fillText('Statement', PAD, y)
  ctx.textAlign = 'right'
  ctx.font = `400 28px ${SANS}`
  ctx.fillStyle = MUTED
  ctx.fillText(longDate(todayStr()), W - PAD, y - 34)
  ctx.fillText(invoiceNumber(client), W - PAD, y + 2)
  y += 80
  ctx.textAlign = 'left'
  ctx.font = `400 28px ${SANS}`
  ctx.fillStyle = MUTED
  ctx.fillText('FOR', PAD, y)
  ctx.font = `600 38px ${SANS}`
  ctx.fillStyle = INK
  ctx.fillText(fit(ctx, client.name, W - PAD * 2 - 60), PAD, y + 50)
  y += 130

  // Visits table.
  const cols = [PAD, PAD + 250, PAD + 630, W - PAD]
  ctx.font = `600 24px ${SANS}`
  ctx.fillStyle = MUTED
  ;['DATE', 'SERVICE', 'WITH'].forEach((h, i) => ctx.fillText(h, cols[i], y))
  ctx.textAlign = 'right'
  ctx.fillText('AMOUNT', cols[3], y)
  y += 22
  ctx.fillStyle = ROSE
  ctx.fillRect(PAD, y, W - PAD * 2, 3)
  y += 18
  for (const v of visits) {
    y += ROW - 18
    ctx.textAlign = 'left'
    ctx.fillStyle = INK
    ctx.font = `400 30px ${SANS}`
    ctx.fillText(shortDay(v.date), cols[0], y)
    ctx.fillText(fit(ctx, v.service || 'Treatment', cols[2] - cols[1] - 24), cols[1], y)
    ctx.fillStyle = MUTED
    ctx.fillText(fit(ctx, nameOf(v.employeeId) || v.employeeName || '', cols[3] - cols[2] - 190), cols[2], y)
    ctx.textAlign = 'right'
    ctx.fillStyle = INK
    ctx.fillText(fmt(owing(v)), cols[3], y)
    y += 18
    ctx.fillStyle = LINE
    ctx.fillRect(PAD, y, W - PAD * 2, 2)
  }

  // Amount due.
  y += 40
  ctx.fillStyle = BLUSH
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(PAD, y, W - PAD * 2, 110, 20) : ctx.rect(PAD, y, W - PAD * 2, 110)
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = INK
  ctx.font = `600 32px ${SANS}`
  ctx.fillText('Amount due', PAD + 36, y + 68)
  ctx.textAlign = 'right'
  ctx.font = `50px ${SERIF}`
  ctx.fillStyle = ROSE
  ctx.fillText(fmt(total), W - PAD - 36, y + 72)
  y += 170

  // How to pay.
  ctx.textAlign = 'left'
  if (bank.length) {
    ctx.fillStyle = ROSE
    ctx.font = `26px ${SERIF}`
    ctx.fillText('HOW TO PAY (EFT)', PAD, y)
    y += 50
    ctx.fillStyle = INK
    ctx.font = `400 30px ${SANS}`
    for (const line of [...bank, `Reference: ${client.name}`]) {
      ctx.fillText(fit(ctx, line, W - PAD * 2), PAD, y)
      y += 44
    }
    y += 16
  } else {
    ctx.fillStyle = INK
    ctx.font = `400 30px ${SANS}`
    ctx.fillText('You can pay at your next visit. Thank you!', PAD, y)
    y += 70
  }

  // Footer.
  ctx.fillStyle = LINE
  ctx.fillRect(PAD, y, W - PAD * 2, 2)
  y += 50
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = `400 25px ${SANS}`
  const footer = [company.name || 'Little Lash Lounge', company.registration && `Reg. ${company.registration}`].filter(Boolean).join(' · ')
  ctx.fillText(fit(ctx, footer, W - PAD * 2), W / 2, y)
  const contact = [String(company.address || '').split(/\n|,\s*/).filter(Boolean).slice(0, 2).join(', '), company.phone, company.email].filter(Boolean).join(' · ')
  if (contact) ctx.fillText(fit(ctx, contact, W - PAD * 2), W / 2, y + 40)
  ctx.fillStyle = ROSE
  ctx.font = `italic 30px ${SERIF}`
  ctx.fillText('Thank you for being a Little Lash Lounge client', W / 2, y + 100)

  // Cut to the height used.
  const out = document.createElement('canvas')
  out.width = W
  out.height = Math.ceil(y + 150)
  out.getContext('2d').drawImage(canvas, 0, 0)
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
}
