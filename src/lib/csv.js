import { todayStr } from './format.js'

/** Rows → CSV text (the BOM makes Excel read names like "Irené" correctly). */
export function csv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

/** Saves rows as "<name> <today>.csv". */
export function downloadCsv(name, rows) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name} ${todayStr()}.csv` })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
