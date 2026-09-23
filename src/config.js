/** Build-time settings (see .env.example). */
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
export const DEFAULT_SHEET_ID = import.meta.env.VITE_SPREADSHEET_ID || ''

// For local testing only: ?api=http://localhost:8787 talks to dev/fake-sheets-api.cjs
// instead of Google, and skips sign-in. Ignored in normal production builds.
const canFake = import.meta.env.DEV || import.meta.env.MODE === 'test'
export const FAKE_API = canFake ? new URLSearchParams(location.search).get('api') : null

export const SHEETS_BASE = (FAKE_API || 'https://sheets.googleapis.com') + '/v4/spreadsheets'
