/**
 * A gift voucher as a PNG image (for WhatsApp): the logo, the amount, the code and how long it's good
 * for — no name or note, so it can be passed on as a gift. Drawn on a canvas in the salon's fonts — nothing leaves the phone.
 */
import { fmt } from './format.js'

const W = 1080
const PAD = 72
const INK = '#33292b'
const MUTED = '#8a7d7e'
const ROSE = '#a0555c'
const BLUSH = '#f8e6e4'
const SERIF = '"Libre Baskerville", Georgia, serif'
const SANS = '"Jost Variable", "Helvetica Neue", Arial, sans-serif'
const longDate = (d) => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

const loadImage = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src })
function fit(ctx, text, width) {
  let t = String(text || '')
  if (ctx.measureText(t).width <= width) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
  return t + '…'
}

/** @returns Promise<Blob> (PNG) */
export async function voucherImage(v, company = {}) {
  await Promise.all([document.fonts?.load(`40px ${SERIF}`), document.fonts?.load(`400 30px ${SANS}`), document.fonts?.load(`600 30px ${SANS}`)].map((p) => p?.catch?.(() => {})))
  const logo = await loadImage(import.meta.env.BASE_URL + 'brand/logo.png')
  const H = 1120
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)

  // Blush band with the logo.
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

  // Title, amount, code.
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = `600 26px ${SANS}`
  ctx.fillText('G I F T   V O U C H E R', W / 2, 400)
  ctx.fillStyle = INK
  ctx.font = `120px ${SERIF}`
  ctx.fillText(fmt(v.amount).replace(',00', ''), W / 2, 530)
  if (v.balance < v.amount - 0.005) {
    ctx.fillStyle = ROSE
    ctx.font = `400 30px ${SANS}`
    ctx.fillText(`${fmt(v.balance)} left to use`, W / 2, 580)
  }
  let y = 660
  ctx.fillStyle = BLUSH
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(PAD, y, W - PAD * 2, 110, 20) : ctx.rect(PAD, y, W - PAD * 2, 110)
  ctx.fill()
  ctx.fillStyle = MUTED
  ctx.font = `600 24px ${SANS}`
  ctx.fillText('VOUCHER CODE', W / 2, y + 42)
  ctx.fillStyle = ROSE
  ctx.font = `600 44px ${SANS}`
  ctx.fillText(v.code, W / 2, y + 90)
  y += 180

  // Valid until. No name or note: it may be a gift for someone else, and the note is the salon's own.
  ctx.fillStyle = MUTED
  ctx.font = `400 28px ${SANS}`
  ctx.fillText(v.expiresOn ? `Valid until ${longDate(v.expiresOn)}` : `Sold ${longDate(v.soldOn)}`, W / 2, y)
  y += 54
  ctx.fillStyle = MUTED
  ctx.font = `400 25px ${SANS}`
  ctx.fillText('Show this at your visit — it can be used over more than one visit.', W / 2, y)
  y += 60

  // Footer.
  ctx.fillText(fit(ctx, company.name || 'Little Lash Lounge', W - PAD * 2), W / 2, y)
  const contact = [String(company.address || '').split(/\n|,\s*/).filter(Boolean).slice(0, 2).join(', '), company.phone].filter(Boolean).join(' · ')
  if (contact) { y += 38; ctx.fillText(fit(ctx, contact, W - PAD * 2), W / 2, y) }
  ctx.fillStyle = ROSE
  ctx.font = `italic 30px ${SERIF}`
  ctx.fillText('With love from Little Lash Lounge', W / 2, y + 60)

  const out = document.createElement('canvas')
  out.width = W
  out.height = Math.ceil(y + 110)
  out.getContext('2d').drawImage(canvas, 0, 0)
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
}
