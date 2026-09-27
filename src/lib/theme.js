import { ref } from 'vue'

/** Light / dark / automatic (follow the phone), remembered on this device. */
const KEY = 'llp.theme'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const theme = ref(['light', 'dark'].includes(read()) ? read() : 'auto')

export function setTheme(value) {
  theme.value = value
  const root = document.documentElement
  if (value === 'auto') delete root.dataset.theme
  else root.dataset.theme = value
  try { value === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, value) } catch { /* private mode: just for now */ }
}
