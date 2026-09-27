import { ref } from 'vue'

/** Light / dark / automatic (follow the phone), remembered on this device. */
const KEY = 'llp.theme'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const theme = ref(['light', 'dark'].includes(read()) ? read() : 'auto')

/** The phone's status bar matches the header (blush by day, dark at night). */
export function syncStatusBar() {
  const meta = document.querySelector('meta[name="theme-color"]')
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim()
  if (meta && bar) meta.setAttribute('content', bar)
}
if (typeof window !== 'undefined') {
  syncStatusBar()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncStatusBar)
}

export function setTheme(value) {
  theme.value = value
  const root = document.documentElement
  if (value === 'auto') delete root.dataset.theme
  else root.dataset.theme = value
  syncStatusBar()
  try { value === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, value) } catch { /* private mode: just for now */ }
}
