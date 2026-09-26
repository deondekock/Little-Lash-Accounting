/** Build-time settings (see .env.example). */
// The OAuth client ID is public by design (it only works from the allowed web addresses).
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '860201503699-s0u54svm3lpvd5i0nfq3plmpm4o86477.apps.googleusercontent.com'
export const DEFAULT_SHEET_ID = import.meta.env.VITE_SPREADSHEET_ID || ''

// For local testing only: ?api=http://localhost:8787 talks to dev/fake-sheets-api.cjs
// instead of Google, and skips sign-in. Ignored in normal production builds.
const canFake = import.meta.env.DEV || import.meta.env.MODE === 'test'
export const FAKE_API = canFake ? new URLSearchParams(location.search).get('api') : null

export const SHEETS_BASE = (FAKE_API || 'https://sheets.googleapis.com') + '/v4/spreadsheets'

// Where the salon's data lives: 'sheets' (Google Sheet) or 'cloudflare' (the Worker in /worker).
// For local testing: ?backend=cloudflare&cfapi=http://localhost:8788
const params = new URLSearchParams(location.search)
export const BACKEND = (canFake && params.get('backend')) || import.meta.env.VITE_BACKEND || 'cloudflare'
export const API_URL = (canFake && params.get('cfapi')) || import.meta.env.VITE_API_URL || 'https://little-lash-api.littlelash.workers.dev'
