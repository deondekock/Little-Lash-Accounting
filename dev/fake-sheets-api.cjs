#!/usr/bin/env node
/**
 * A tiny in-memory stand-in for the Google Sheets API v4 — only the calls the
 * app uses — so the app can be tried and tested without a Google account.
 *
 *   node dev/fake-sheets-api.cjs --demo            sample data  (http://localhost:8787)
 *   node dev/fake-sheets-api.cjs --seed data.json  {"Employees":[[…]],"Appointments":[[…]],"Settings":[[…]]} (rows incl. header)
 *
 * Then open the app with ?api=http://localhost:8787 (dev builds only) and use
 * sheet ID "demo" (or whatever ID you POST-create).
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const books = new Map(); // id → { title, sheets: [{ id, title, rows: [[]] }] }

const HEADERS = {
  Employees: ['ID', 'Name', 'Phone', 'Active', 'Created At', 'Updated At'],
  Appointments: ['ID', 'Date', 'Month', 'Employee ID', 'Employee', 'Client', 'Service',
    'Amount', 'Method', 'Status', 'Paid On', 'Notes', 'Created At', 'Updated At'],
  Settings: ['Setting', 'Value'],
};

function newBook(id, title, data) {
  const book = { title, sheets: [] };
  let gid = 0;
  for (const [name, rows] of Object.entries(data)) book.sheets.push({ id: gid++ * 1000 + 7, title: name, rows });
  books.set(id, book);
  return book;
}

/* ---------------- A1 notation ---------------- */

const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (n) => { let s = ''; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function parseRange(book, a1) {
  const m = a1.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.*)$/);
  if (!m) throw httpError(400, 'Unable to parse range: ' + a1);
  const title = (m[1] || m[2]).replace(/''/g, "'");
  const sheet = book.sheets.find((s) => s.title === title);
  if (!sheet) throw httpError(400, 'Unable to parse range: ' + a1);
  const [a, b = a] = m[3].split(':');
  const pa = a.match(/^([A-Z]*)(\d*)$/), pb = b.match(/^([A-Z]*)(\d*)$/);
  return {
    sheet,
    c1: pa[1] ? colNum(pa[1]) : 0,
    r1: pa[2] ? Number(pa[2]) - 1 : 0,
    c2: pb[1] ? colNum(pb[1]) : 25,
    r2: pb[2] ? Number(pb[2]) - 1 : Infinity,
  };
}

/** Like Google: trailing empty cells and rows are left out. */
function readValues(r) {
  const out = [];
  const last = Math.min(r.r2, r.sheet.rows.length - 1);
  for (let i = r.r1; i <= last; i++) {
    const row = (r.sheet.rows[i] || []).slice(r.c1, r.c2 + 1);
    while (row.length && (row[row.length - 1] === '' || row[row.length - 1] == null)) row.pop();
    out.push(row.map((v) => (v == null ? '' : v)));
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

function writeValues(r, values) {
  values.forEach((line, i) => {
    const ri = r.r1 + i;
    while (r.sheet.rows.length <= ri) r.sheet.rows.push([]);
    const row = r.sheet.rows[ri];
    line.forEach((v, j) => { row[r.c1 + j] = v; });
  });
}

const a1 = (sheet, r1, c1, r2, c2) => `'${sheet.title}'!${colName(c1)}${r1 + 1}:${colName(c2)}${r2 + 1}`;

/* ---------------- HTTP ---------------- */

function httpError(code, message) { const e = new Error(message); e.code = code; return e; }

function handle(method, url, body) {
  const path = decodeURIComponent(url.pathname.replace(/^\/v4\/spreadsheets\/?/, ''));
  if (method === 'POST' && path === '') {
    const id = crypto.randomUUID().replace(/-/g, '');
    const data = {};
    for (const s of body.sheets || [{ properties: { title: 'Sheet1' } }]) data[s.properties.title] = [];
    const book = newBook(id, body.properties?.title || 'Untitled', data);
    return meta(id, book);
  }
  const m = path.match(/^([^/:]+)(.*)$/);
  const book = books.get(m[1]);
  if (!book) throw httpError(404, 'Requested entity was not found.');
  const rest = m[2];

  if (method === 'GET' && rest === '') return meta(m[1], book);
  if (method === 'GET' && rest === '/values:batchGet') {
    return { spreadsheetId: m[1], valueRanges: url.searchParams.getAll('ranges').map((r) => ({ range: r, values: readValues(parseRange(book, r)) })) };
  }
  if (method === 'POST' && rest === '/values:batchUpdate') {
    for (const d of body.data) writeValues(parseRange(book, d.range), d.values);
    return { spreadsheetId: m[1], totalUpdatedCells: body.data.length };
  }
  if (method === 'POST' && rest === ':batchUpdate') {
    for (const req of body.requests) {
      if (req.deleteDimension) {
        const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
        const sheet = book.sheets.find((s) => s.id === sheetId);
        if (!sheet) throw httpError(400, 'No grid with id: ' + sheetId);
        sheet.rows.splice(startIndex, endIndex - startIndex);
      } else if (req.addSheet) {
        book.sheets.push({ id: book.sheets.length * 1000 + 7, title: req.addSheet.properties.title, rows: [] });
      } else {
        throw httpError(400, 'Unsupported request in fake API: ' + Object.keys(req)[0]);
      }
    }
    return { spreadsheetId: m[1], replies: [] };
  }
  const vm = rest.match(/^\/values\/(.+?)(:append)?$/);
  if (vm) {
    const r = parseRange(book, vm[1]);
    if (method === 'GET') return { range: vm[1], values: readValues(r) };
    if (method === 'PUT') { writeValues(r, body.values); return { updatedRange: vm[1] }; }
    if (method === 'POST' && vm[2]) {
      // Append after the last row that has data.
      let last = r.sheet.rows.length - 1;
      while (last >= 0 && !(r.sheet.rows[last] || []).some((v) => v !== '' && v != null)) last--;
      const start = last + 1;
      writeValues({ ...r, r1: start }, body.values);
      return { updates: { updatedRange: a1(r.sheet, start, r.c1, start + body.values.length - 1, r.c1 + body.values[0].length - 1) } };
    }
  }
  throw httpError(400, `Fake API does not support ${method} ${url.pathname}`);
}

function meta(id, book) {
  return {
    spreadsheetId: id,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    properties: { title: book.title },
    sheets: book.sheets.map((s) => ({ properties: { sheetId: s.id, title: s.title } })),
  };
}

/* ---------------- seed data ---------------- */

const seedArg = process.argv.indexOf('--seed');
if (seedArg > 0) {
  newBook('demo', 'Little Lash Lounge Payments', JSON.parse(require('fs').readFileSync(process.argv[seedArg + 1], 'utf8')));
} else {
  const rows = { Employees: [HEADERS.Employees], Appointments: [HEADERS.Appointments], Settings: [HEADERS.Settings, ['Month starts on day', 26]] };
  if (process.argv.includes('--demo')) {
    const now = new Date().toISOString();
    const emps = ['Chrisilda', 'Stefni', 'Leanke'].map((name) => [crypto.randomUUID(), name, '', true, now, now]);
    rows.Employees.push(...emps);
    const clients = ['Marise', 'Mia', 'Sylvie', 'Estelle', 'Elmarie', 'Kim', 'Riette', 'LeoAnn', 'Cherry', 'Zara', 'Odette', 'Yvette'];
    const services = ['Classic full set', 'Volume fill', 'Hybrid set', 'Lash lift', ''];
    const prices = [570, 500, 470, 395, 365, 350, 435, 420];
    const methods = ['Card', 'Card', 'Card', 'EFT', 'Cash'];
    let seed = 7;
    const rnd = (n) => ((seed = (seed * 9301 + 49297) % 233280), Math.floor((seed / 233280) * n));
    const pad = (n) => String(n).padStart(2, '0');
    const today = new Date();
    for (let back = 90; back >= 0; back--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
      if (d.getDay() === 0) continue;
      for (let i = 0; i < 3 + rnd(4); i++) {
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const dd = d.getDate() >= 26 ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : d;
        const month = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}`;
        const e = emps[rnd(emps.length)];
        const status = back > 10 || rnd(3) ? 'Paid' : 'Unpaid';
        rows.Appointments.push([crypto.randomUUID(), date, month, e[0], e[1], clients[rnd(clients.length)],
          services[rnd(services.length)], prices[rnd(prices.length)], methods[rnd(methods.length)], status,
          status === 'Paid' ? date : '', '', now, now]);
      }
    }
  }
  newBook('demo', 'Little Lash Lounge Payments', rows);
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let status = 200, out;
    try {
      if (!/^Bearer .+/.test(req.headers.authorization || '') || req.headers.authorization === 'Bearer expired') throw httpError(401, 'Request had invalid authentication credentials.');
      out = handle(req.method, new URL(req.url, 'http://x'), body ? JSON.parse(body) : {});
    } catch (e) {
      status = e.code || 500;
      out = { error: { code: status, message: e.message } };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`Fake Google Sheets API on http://localhost:${PORT} (sheet ID: demo)`));
