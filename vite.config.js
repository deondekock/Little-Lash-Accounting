import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Each build gets its own version; the app compares it with version.json to spot a newer release.
const VERSION = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

const versionFile = {
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) })
  },
}

// GitHub Pages serves the site from /Little-Lash-Accounting/ (set by the deploy workflow).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [vue(), versionFile],
})
