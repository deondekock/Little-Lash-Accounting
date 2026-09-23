import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves the site from /Little-Lash-Accounting/ (set by the deploy workflow).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [vue()],
})
