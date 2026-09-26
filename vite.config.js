import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// GitHub Pages serves the site from /Little-Lash-Accounting/ (set by the deploy workflow).
// Two pages: the salon app (index.html) and the clients' booking page (book/index.html).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), book: resolve(__dirname, 'book/index.html') },
    },
  },
})
