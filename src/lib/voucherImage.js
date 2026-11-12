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

/** Draws text with letter spacing (char by char, so it works on every phone), centred on x. */
function spaced(ctx, text, x, y, gap) {
  const chars = [...String(text)]
  const widths = chars.map((c) => ctx.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)
  let cx = x - total / 2
  const align = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + gap })
  ctx.textAlign = align
}

/**
 * Square, mostly white, in the style of the salon's own voucher card: a soft logo watermark behind a
 * "Gift VOUCHER" heading, the line printed on the voucher as the headline, the value, the code, and
 * the validity + contact details along the bottom.
 * @returns Promise<Blob> (PNG)
 */
export async function voucherImage(v, company = {}) {
  await Promise.all([document.fonts?.load(`40px ${SERIF}`), document.fonts?.load(`italic 40px ${SERIF}`), document.fonts?.load(`400 30px ${SANS}`), document.fonts?.load(`600 30px ${SANS}`)].map((p) => p?.catch?.(() => {})))
  const logo = await loadImage(import.meta.env.BASE_URL + 'brand/logo.png')
  const H = W // square, like hers
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)

  // Soft logo watermark across the middle.
  if (logo) {
    const lw = W - 40
    const lh = (logo.height / logo.width) * lw
    ctx.globalAlpha = 0.16
    ctx.drawImage(logo, (W - lw) / 2, 350 - lh / 2, lw, lh)
    ctx.globalAlpha = 1
  }

  ctx.textAlign = 'center'
  // "Gift" in a flowing italic, "VOUCHER" wide and light underneath.
  ctx.fillStyle = INK
  ctx.font = `italic 96px ${SERIF}`
  ctx.fillText('Gift', W / 2, 190)
  ctx.font = `400 84px ${SERIF}`
  spaced(ctx, 'VOUCHER', W / 2, 330, 6)
  ctx.fillStyle = MUTED
  ctx.font = `400 26px ${SANS}`
  spaced(ctx, 'Enjoy your voucher', W / 2, 390, 3)
  // Thin divider.
  ctx.fillStyle = INK
  ctx.fillRect(W / 2 - 1, 420, 2, 110)

  // Headline: the line printed on the voucher, else the amount.
  let y = 610
  ctx.fillStyle = INK
  if (v.voucherNote) {
    ctx.font = `400 54px ${SERIF}`
    let t = v.voucherNote
    while (t.length > 1 && ctx.measureText(t).width > W - PAD * 2) t = t.slice(0, -1)
    ctx.fillText(t === v.voucherNote ? t : t + '…', W / 2, y)
    y += 64
    ctx.font = `400 34px ${SERIF}`
    ctx.fillText(`Value of: ${fmt(v.amount).replace(',00', '')}`, W / 2, y)
  } else {
    ctx.font = `400 92px ${SERIF}`
    ctx.fillText(fmt(v.amount).replace(',00', ''), W / 2, y + 14)
    y += 64
  }
  if (v.balance < v.amount - 0.005) {
    y += 42
    ctx.fillStyle = ROSE
    ctx.font = `400 28px ${SANS}`
    ctx.fillText(`${fmt(v.balance)} left to use`, W / 2, y)
  }
  // The code, with a soft chip behind it.
  y += 78
  ctx.font = `600 24px ${SANS}`
  const codeLabel = `VOUCHER CODE  ${v.code}`
  const cw = ctx.measureText(codeLabel).width + 60
  ctx.fillStyle = BLUSH
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect((W - cw) / 2, y - 30, cw, 50, 25) : ctx.rect((W - cw) / 2, y - 30, cw, 50)
  ctx.fill()
  ctx.fillStyle = MUTED
  ctx.fillText('VOUCHER CODE', W / 2 - ctx.measureText(`  ${v.code}`).width / 2 - 6, y + 4)
  ctx.fillStyle = ROSE
  ctx.font = `600 26px ${SANS}`
  ctx.fillText(v.code, W / 2 + ctx.measureText('VOUCHER CODE ').width / 2 - 2, y + 4)
  y += 54
  ctx.fillStyle = MUTED
  ctx.font = `400 23px ${SANS}`
  ctx.fillText('Show this at your visit · it can be used over more than one visit', W / 2, y)

  // Bottom corners: validity on the left, contact on the right (like her card).
  const by = H - 64
  ctx.fillStyle = MUTED
  ctx.textAlign = 'left'
  ctx.font = `400 30px ${SERIF}`
  ctx.fillText(v.expiresOn ? `valid till ${longDate(v.expiresOn)}` : `sold ${longDate(v.soldOn)}`, PAD - 20, by)
  ctx.textAlign = 'right'
  ctx.font = `400 26px ${SANS}`
  const lines = [company.email && company.email.toUpperCase(), company.phone, !company.email && !company.phone && (company.name || 'Little Lash Lounge')].filter(Boolean)
  lines.forEach((l, i) => ctx.fillText(fit(ctx, l, W / 2), W - PAD + 20, by - (lines.length - 1 - i) * 36))

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
