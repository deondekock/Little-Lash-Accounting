import { copyFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The whole Vue app is bundled into ONE html file (Apps Script can only serve
// files from the project), then copied to apps-script/Index.html.
export default defineConfig({
  plugins: [
    vue(),
    viteSingleFile(),
    {
      name: 'copy-to-apps-script',
      apply: 'build',
      closeBundle() {
        copyFileSync('dist/index.html', 'apps-script/Index.html')
        console.log('\n✓ Wrote apps-script/Index.html')
      },
    },
  ],
  server: {
    // `npm run dev` runs the fake Apps Script backend on 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
