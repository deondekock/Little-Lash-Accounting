import { createApp } from 'vue'
import BookApp from './BookApp.vue'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/fraunces/wght-italic.css'
import '../style.css'
import './book.css'

createApp(BookApp).mount('#app')

// Installable, and reminders on the phone (the service worker lives one folder up).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {}))
}
