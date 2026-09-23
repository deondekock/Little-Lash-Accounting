#!/usr/bin/env node
/**
 * Local preview: runs apps-script/Code.gs against an in-memory fake of the
 * Apps Script services (SpreadsheetApp etc.) and serves the built
 * apps-script/Index.html. The Vue app talks to it via POST /api/<function>
 * (see src/api.js). Lets you try the app without deploying.
 *
 *   node dev/preview-server.cjs              → http://localhost:8080 (run `npm run build` first)
 *   node dev/preview-server.cjs --demo       → same, pre-filled with sample data
 *   node dev/preview-server.cjs --api-only   → API only on :8787, for `npm run dev` (Vite proxies to it)
 *   node dev/preview-server.cjs --import old-tabs.json
 *       → runs importOldSheet() against an exported copy of the old sheet
 *         (JSON: [{ title, values }], date cells as { "$serial": n }). Never commit that file.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const API_ONLY = process.argv.includes('--api-only');
const PORT = Number(process.env.PORT) || (API_ONLY ? 8787 : 8080);

/* ---------------- fake Apps Script services ---------------- */

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((v) => v.length !== this.cols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      line.forEach((v, c) => (this.sheet.data[idx][this.col - 1 + c] = v));
    });
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getRange(row, col, rows = 1, cols = 1) {
    if (typeof row === 'string') throw new Error('A1 notation not supported in fake');
    if (rows < 1 || cols < 1) throw new Error('Range must be at least 1x1');
    return new FakeRange(this, row, col, rows, cols);
  }
  deleteRow(n) { this.data.splice(n - 1, 1); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(1, ...this.data.map((r) => r.length))); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(name) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSpreadsheetTimeZone() { return 'Africa/Johannesburg'; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

const spreadsheets = new Map();
const userProps = new Map();
const scriptProps = new Map();
const props = (m) => ({
  getProperty: (k) => (m.has(k) ? m.get(k) : null),
  setProperty: (k, v) => m.set(k, String(v)),
});

const pad = (n) => String(n).padStart(2, '0');
const gas = {
  SpreadsheetApp: {
    create(name) { const ss = new FakeSpreadsheet(name); spreadsheets.set(ss.id, ss); return ss; },
    openById(id) {
      if (!spreadsheets.has(id)) throw new Error('Spreadsheet not found');
      return spreadsheets.get(id);
    },
  },
  PropertiesService: { getUserProperties: () => props(userProps), getScriptProperties: () => props(scriptProps) },
  Session: { getActiveUser: () => ({ getEmail: () => 'preview@example.com' }), getScriptTimeZone: () => 'Africa/Johannesburg' },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => f
      .replace('yyyy', d.getFullYear())
      .replace(/M+/, (x) => (x.length > 1 ? pad(d.getMonth() + 1) : d.getMonth() + 1))
      .replace(/d+/, (x) => (x.length > 1 ? pad(d.getDate()) : d.getDate())),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  HtmlService: {},
  console,
};

const context = vm.createContext(gas);
for (const f of ['Code.gs', 'Import.gs']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'), context, { filename: f });
}

function callServer(fn, args) {
  // Each request gets a fresh cached-spreadsheet, like a real Apps Script execution.
  vm.runInContext('spreadsheet_ = null;', context);
  if (fn.endsWith('_') || typeof context[fn] !== 'function') throw new Error('Unknown function ' + fn);
  // Round-trip through JSON, like google.script.run does.
  return JSON.parse(JSON.stringify(context[fn](...JSON.parse(JSON.stringify(args))) ?? null));
}

/* ---------------- import of the old sheet ---------------- */

const importArg = process.argv.indexOf('--import');
if (importArg > 0) {
  const tabs = JSON.parse(fs.readFileSync(process.argv[importArg + 1], 'utf8'));
  const old = new FakeSpreadsheet('Little Lash Lounge Income');
  old.id = vm.runInContext('OLD_SHEET_ID', context);
  old.sheets = tabs.map((t) => {
    const sh = new FakeSheet(t.title);
    // Google Sheets returns date cells as Date objects (serial days since 1899-12-30).
    sh.data = t.values.map((r) => r.map((v) => (v && typeof v === 'object' && '$serial' in v
      ? new Date(1899, 11, 30 + Math.floor(v.$serial)) : v)));
    return sh;
  });
  spreadsheets.set(old.id, old);
  console.time('importOldSheet');
  console.log(callServer('importOldSheet', []));
  console.timeEnd('importOldSheet');
}

/* ---------------- demo data ---------------- */

if (process.argv.includes('--demo')) {
  const names = ['Chrisilda', 'Lize', 'Nadia'];
  let emps = [];
  names.forEach((name) => (emps = callServer('saveEmployee', [{ name }])));
  const clients = ['Marise', 'Mia', 'Sylvie', 'Estelle', 'Elmarie', 'Kim', 'Riette', 'LeoAnn', 'Cherry',
    'Antoinette', 'Zara', 'Odette', 'Courtney', 'Ronette', 'Yvette', 'Therene'];
  const services = ['Classic full set', 'Volume fill', 'Hybrid set', 'Lash lift', 'Classic fill'];
  const prices = [570, 500, 470, 395, 365, 350, 435, 420, 150];
  const methods = ['Card', 'Card', 'Card', 'EFT', 'Cash'];
  const today = new Date();
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 9301 + 49297) % 233280), Math.floor((seed / 233280) * n));
  for (let back = 3; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const days = back === 0 ? today.getDate() : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    for (let i = 0; i < 18 + rnd(10); i++) {
      const day = 1 + rnd(days);
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`;
      callServer('saveAppointment', [{
        date, employeeId: emps[rnd(emps.length)].id, client: clients[rnd(clients.length)],
        service: services[rnd(services.length)], amount: prices[rnd(prices.length)],
        method: methods[rnd(methods.length)], status: back > 0 || rnd(3) ? 'Paid' : 'Unpaid',
      }]);
    }
  }
}

/* ---------------- http server ---------------- */


http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let out;
      try { out = { result: callServer(req.url.slice(5), JSON.parse(body || '[]')) }; } catch (e) { out = { error: e.message }; }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      }, 150); // simulate a little network latency
    });
    return;
  }
  if (API_ONLY) {
    res.writeHead(404);
    return res.end('API only — open the Vite dev server instead.');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(ROOT, 'apps-script/Index.html'), 'utf8'));
}).listen(PORT, () => console.log(API_ONLY ? `Fake Apps Script API on :${PORT}` : `Preview running at http://localhost:${PORT}`));
