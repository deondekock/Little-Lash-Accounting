#!/usr/bin/env node
/**
 * Local preview: runs src/Code.gs against an in-memory fake of the Apps Script
 * services (SpreadsheetApp etc.) and serves src/Index.html with a
 * google.script.run shim. Lets you try the app without deploying.
 *
 *   node dev/preview-server.js        → http://localhost:8080
 *   node dev/preview-server.js --demo → same, pre-filled with sample data
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

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
      .replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  HtmlService: {},
  console,
};

const context = vm.createContext(gas);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/Code.gs'), 'utf8'), context, { filename: 'Code.gs' });

function callServer(fn, args) {
  // Each request gets a fresh cached-spreadsheet, like a real Apps Script execution.
  vm.runInContext('spreadsheet_ = null;', context);
  if (fn.endsWith('_') || typeof context[fn] !== 'function') throw new Error('Unknown function ' + fn);
  // Round-trip through JSON, like google.script.run does.
  return JSON.parse(JSON.stringify(context[fn](...JSON.parse(JSON.stringify(args))) ?? null));
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

const SHIM = `<script>
  window.google = { script: { get run() {
    let ok = () => {}, err = (e) => console.error(e);
    const runner = new Proxy({}, { get(_, fn) {
      if (fn === 'withSuccessHandler') return (f) => ((ok = f), runner);
      if (fn === 'withFailureHandler') return (f) => ((err = f), runner);
      return (...args) => fetch('/api/' + fn, { method: 'POST', body: JSON.stringify(args) })
        .then((r) => r.json()).then((r) => (r.error ? err(new Error(r.error)) : ok(r.result)), err);
    } });
    return runner;
  } } };
</script>`;

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
  const html = fs.readFileSync(path.join(ROOT, 'src/Index.html'), 'utf8').replace('<head>', '<head>' + SHIM);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(PORT, () => console.log(`Preview running at http://localhost:${PORT}`));
