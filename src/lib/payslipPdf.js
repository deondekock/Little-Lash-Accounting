/**
 * A payslip as a real PDF file, built in the browser (no print screen). Same layout as
 * PayslipDocument.vue: logo + heading, employee / company / leave details, the earnings and
 * deductions table, the totals. One page per payslip; several payslips make one file.
 */
import { fmt, monthLabel, shortDate } from './format.js'
import { salaryLabel } from './payroll.js'

const ROSE = [0.627, 0.333, 0.361] // --brand
const INK = [0.13, 0.11, 0.12]
const MUTED = [0.45, 0.42, 0.43]
const LINE = [0.9, 0.86, 0.87]
const SOFT = [0.976, 0.91, 0.906] // --brand-soft
const A4 = [595.28, 841.89]
const PAD = 48

// Helvetica only knows WinAnsi: swap the few characters our formatters use that it can't draw.
const clean = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/[^\x20-\x7e¡-ÿ–—‘’“”•]/g, '')
const date = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const days = (n) => `${Math.round((n || 0) * 100) / 100} day(s)`
const lines = (text) => String(text || '').split(/\n|,\s*/).map((x) => x.trim()).filter(Boolean)

let logoBytes = null
async function logo() {
  if (logoBytes) return logoBytes
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'brand/logo.png')
    logoBytes = res.ok ? await res.arrayBuffer() : false
  } catch { logoBytes = false }
  return logoBytes
}

/** Builds the PDF (bytes) for one or more saved payslips. */
export async function payslipPdf(slips) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const first = slips[0]
  doc.setTitle(slips.length === 1 ? `Payslip ${first.name} ${monthLabel(first.month)}` : `Payslips ${monthLabel(first.month)}`)
  doc.setProducer('Little Lash Lounge')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const png = await logo()
  const img = png ? await doc.embedPng(png) : null

  for (const s of slips) {
    const page = doc.addPage(A4)
    const [W, H] = A4
    const p = s.pay || {}
    const co = s.company || {}
    const col = (c) => rgb(...c)
    const text = (str, x, y, { size = 10, f = font, color = INK, align = 'left', max = null } = {}) => {
      let t = clean(str)
      if (max) while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + '…'
      const w = f.widthOfTextAtSize(t, size)
      const dx = align === 'right' ? -w : align === 'center' ? -w / 2 : 0
      page.drawText(t, { x: x + dx, y, size, font: f, color: col(color) })
    }
    const rule = (y, color = LINE, h = 0.8) => page.drawRectangle({ x: PAD, y, width: W - PAD * 2, height: h, color: col(color) })

    // Header: logo, company, heading, month on the left; pay date and period on the right.
    let y = H - PAD
    if (img) {
      const h = 46
      page.drawImage(img, { x: PAD, y: y - h, width: (img.width / img.height) * h, height: h })
      y -= h + 10
    }
    text(co.name || 'Little Lash Lounge', PAD, y - 10, { size: 10, color: MUTED })
    text('Payslip', PAD, y - 40, { size: 26, f: serif })
    text(monthLabel(s.month), PAD, y - 56, { size: 12, color: ROSE })
    const right = W - PAD
    text('Pay date', right - 200, H - PAD - 10, { size: 8.5, color: MUTED })
    text(date(s.payDate), right, H - PAD - 10, { size: 10, align: 'right' })
    text('Period', right - 200, H - PAD - 26, { size: 8.5, color: MUTED })
    text(`${shortDate(s.period.from)} – ${shortDate(s.period.to)} ${s.period.to.slice(0, 4)}`, right, H - PAD - 26, { size: 10, align: 'right' })
    y -= 76
    rule(y, ROSE, 1.2)
    y -= 22

    // Two columns of details.
    const colW = (W - PAD * 2 - 24) / 2
    const details = (x, top, title, items) => {
      let yy = top
      text(title.toUpperCase(), x, yy, { size: 8.5, f: bold, color: ROSE })
      yy -= 16
      for (const [k, v] of items) {
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
        text(k, x, yy, { size: 9, color: MUTED })
        for (const line of Array.isArray(v) ? v : [v]) {
          text(line, x + 100, yy, { size: 9.5, max: colW - 100 })
          yy -= 13
        }
      }
      return yy
    }
    const yL = details(PAD, y, 'Employee details', [
      ['Employee name', s.name], ['Employee code', p.code], ['ID number', p.idNumber], ['Address', lines(p.address)],
      ['Date engaged', date(p.engaged)], ['Tax number', p.taxNumber], ['Bank name', p.bankName], ['Account type', p.accountType],
      ['Account number', p.accountNumber], ['Branch code', p.branchCode],
    ])
    let yR = details(PAD + colW + 24, y, 'Company details', [
      ['Company name', co.name], ['Company type', co.type], ['Registration no.', co.registration], ['Address', lines(co.address)],
      ['PAYE reference', co.payeRef], ['UIF reference', co.uifRef],
    ])
    if (s.leave?.start) {
      yR = details(PAD + colW + 24, yR - 8, 'Annual leave', [
        ['Leave accrued', days(s.leave.accruedThisMonth)], ['Leave taken', `${s.leave.takenThisMonth || 0} hours`],
        ['Total leave', `${days(s.leave.days)} · ${s.leave.hours} h`],
        ['Sick leave left', s.leave.sick ? `${s.leave.sick.hours} h (cycle to ${shortDate(s.leave.sick.to)} ${s.leave.sick.to.slice(0, 4)})` : ''],
        ['Family leave left', s.leave.family?.eligible ? `${s.leave.family.hours} h` : ''],
      ])
    }
    y = Math.min(yL, yR) - 14

    // Earnings | Deductions table.
    const mid = PAD + colW + 12
    rule(y + 10, ROSE, 1)
    text('EARNINGS', PAD, y - 4, { size: 8.5, f: bold, color: ROSE })
    text('DEDUCTIONS', mid + 12, y - 4, { size: 8.5, f: bold, color: ROSE })
    y -= 22
    const n = Math.max(s.earnings.length, s.deductions.length)
    for (let i = 0; i < n; i++) {
      const e = s.earnings[i]
      const d = s.deductions[i]
      if (e) { text(i === 0 ? salaryLabel(e.label) : e.label, PAD, y, { size: 10, max: colW - 90 }); text(fmt(e.amount), mid - 12, y, { size: 10, align: 'right' }) }
      if (d) { text(d.label, mid + 12, y, { size: 10, max: colW - 90 }); text(fmt(d.amount), right, y, { size: 10, align: 'right' }) }
      y -= 16
      rule(y + 11)
    }
    y -= 8

    // Totals.
    const total = (label, value, strong = false) => {
      if (strong) page.drawRectangle({ x: PAD, y: y - 10, width: W - PAD * 2, height: 30, color: col(SOFT) })
      text(label, PAD + (strong ? 12 : 0), y, { size: strong ? 12 : 10, f: bold, color: strong ? ROSE : INK })
      text(fmt(value), right - (strong ? 12 : 0), y, { size: strong ? 14 : 10.5, f: bold, align: 'right', color: strong ? ROSE : INK })
      y -= strong ? 34 : 18
    }
    total('Total earnings', s.gross)
    total('Total deductions', s.totalDeductions)
    y -= 6
    total('Nett pay', s.net, true)
    if (s.employerUif) text(`Employer UIF contribution: ${fmt(s.employerUif)}`, PAD, y, { size: 8.5, color: MUTED })

    // Footer.
    text(`${co.name || 'Little Lash Lounge'}${co.registration ? ' · Reg. ' + co.registration : ''}`, W / 2, PAD - 6, { size: 8, color: MUTED, align: 'center' })
  }
  return doc.save()
}

/**
 * Hands a file to the user: the phone's share sheet (Save to Files, WhatsApp, email…) when it can
 * take files, else a plain download.
 */
export async function saveFile(bytes, name, type = 'application/pdf') {
  const file = new File([bytes], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return } catch (err) { if (err.name === 'AbortError') return }
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** Build and hand over the PDF for these payslips. */
export async function downloadPayslipPdf(slips) {
  const first = slips[0]
  const name = (slips.length === 1 ? `Payslip ${first.name} ${monthLabel(first.month)}` : `Payslips ${monthLabel(first.month)}`).replace(/[^\w .-]+/g, '') + '.pdf'
  await saveFile(await payslipPdf(slips), name)
}
