/**
 * One-time import of the old "Little Lash Lounge Income" spreadsheet.
 *
 * How to run: in the Apps Script editor pick `importOldSheet` in the function
 * dropdown at the top and click ▶ Run. It reads the old sheet (it is not
 * changed) and fills the app's Employees / Appointments tabs.
 *
 * The old sheet has one tab per year, and in each tab one column block per
 * employee (Date | Client | [Treatment] | Cash | Card | Eft | 1) repeated per
 * month with total rows underneath. Layouts differ a little between years, so
 * the parser is forgiving: it finds the blocks from the header rows, repairs
 * mistyped dates, and skips totals, notes, loans and refunds.
 */

const OLD_SHEET_ID = '1TqDtOvEqi6WYmL46loeCar9iCf-_JWUaYkS1BuOlscI';
const IMPORT_MONTH_START_DAY = 26;
// Appointments from this business month on keep the old sheet's "1" = paid
// marker (blank = unpaid). Anything older is simply marked Paid.
const IMPORT_TRACK_UNPAID_FROM = '2026-01';

function importOldSheet() {
  const ss = getSpreadsheet_();
  const apptSheet = getSheet_(APPOINTMENTS);
  if (apptSheet.getLastRow() > 1) {
    throw new Error('The Appointments tab already has data. Delete those rows first so nothing is imported twice.');
  }

  const old = SpreadsheetApp.openById(OLD_SHEET_ID);
  const tz = old.getSpreadsheetTimeZone();
  const tabs = old.getSheets().map(function (sh) {
    return { title: sh.getName(), values: sh.getDataRange().getValues() };
  });
  const result = parseOldWorkbook_(tabs, tz, IMPORT_MONTH_START_DAY);

  // Settings: business months start on the 26th, like the old sheet.
  const settings = getSheet_(SETTINGS);
  settings.getRange(2, 1, 1, 2).setValues([[MONTH_START_SETTING, IMPORT_MONTH_START_DAY]]);

  // Employees (reuse any that already exist with the same name).
  const existing = {};
  listEmployees_().forEach(function (e) { existing[e.name.toLowerCase()] = e.id; });
  const recent = {};
  result.appointments.forEach(function (a) { if (a.month >= IMPORT_TRACK_UNPAID_FROM) recent[a.employee] = true; });
  const empSheet = getSheet_(EMPLOYEES);
  const now = new Date().toISOString();
  const ids = {};
  const newEmployees = [];
  Object.keys(result.employees).sort().forEach(function (name) {
    const key = name.toLowerCase();
    if (existing[key]) { ids[name] = existing[key]; return; }
    ids[name] = Utilities.getUuid();
    newEmployees.push([ids[name], name, '', !!recent[name], now, now]);
  });
  if (newEmployees.length) {
    const start = empSheet.getLastRow() + 1;
    empSheet.getRange(start, 1, newEmployees.length, EMPLOYEE_HEADERS.length)
      .setNumberFormat('@')
      .setValues(newEmployees);
    empSheet.getRange(start, E.ACTIVE + 1, newEmployees.length, 1).setNumberFormat('General');
  }

  // Appointments, oldest first.
  const rows = result.appointments
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .map(function (a) {
      const status = a.month < IMPORT_TRACK_UNPAID_FROM || a.paidMark ? 'Paid' : 'Unpaid';
      return [Utilities.getUuid(), a.date, a.month, ids[a.employee], a.employee, a.client, a.service,
        a.amount, a.method, status, '', '', now, now];
    });
  const CHUNK = 4000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const range = apptSheet.getRange(apptSheet.getLastRow() + 1, 1, part.length, APPOINTMENT_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues(part);
  }
  if (rows.length) {
    apptSheet.getRange(2, A.AMOUNT + 1, rows.length, 1).setNumberFormat('"R "#,##0.00');
  }

  const summary = 'Imported ' + rows.length + ' appointments for ' + Object.keys(result.employees).length +
    ' employees (' + Object.keys(result.employees).sort().join(', ') + ').';
  console.log(summary);
  console.log('Notes (' + result.log.length + '):\n' + result.log.join('\n'));
  return summary;
}

/* ------------------------------------------------------------------ */
/* Parser (pure — no Apps Script services, so it can be tested)        */
/* ------------------------------------------------------------------ */

/**
 * tabs: [{ title, values }] where values is getValues() output.
 * Returns { appointments: [{date, month, employee, client, service, amount, method, paidMark}], employees, log }.
 */
function parseOldWorkbook_(tabs, tz, startDay) {
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    // Afrikaans and common typos seen in the sheet
    mei: 5, okt: 10, des: 12, maa: 3, juy: 7, jnu: 6, agu: 8, spe: 9, set: 9, mrt: 3, mrc: 3, mr: 3, ayg: 8,
    ap: 4, se: 9, ja: 1, fe: 2, no: 11, de: 12, oc: 10,
  };
  const STOP = /total|yoco|silla|commission|salary|salaris|profit|wins/i;
  const HEADER_WORDS = { date: 1, client: 1, service: 1, treatment: 1, cash: 1, card: 1, eft: 1, paid: 1, x: 1, excuses: 1 };
  const KEYS = { client: 'client', cash: 'Cash', card: 'Card', eft: 'EFT', treatment: 'service', service: 'service' };
  const METHOD_KEYS = ['Cash', 'Card', 'EFT'];
  const log = [];

  /* ---- dates are handled as { y, m, d } ---- */
  function valid(y, m, d) {
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function mk(y, m, d) { return valid(y, m, d) ? { y: y, m: m, d: d } : null; }
  function num(x) { return Date.UTC(x.y, x.m - 1, x.d) / 864e5; }
  function fromNum(n) { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  function iso(x) { return x.y + '-' + ('0' + x.m).slice(-2) + '-' + ('0' + x.d).slice(-2); }
  function ymStr(y, m) { return y + '-' + ('0' + m).slice(-2); }
  function nextYM(y, m) { return m === 12 ? [y + 1, 1] : [y, m + 1]; }
  function period(x) { return x.d >= startDay ? nextYM(x.y, x.m) : [x.y, x.m]; }
  function inWindow(x, y, m) {
    // previous month's 10th → this month's end + 9 days
    const start = num({ y: m === 1 ? y - 1 : y, m: m === 1 ? 12 : m - 1, d: 10 });
    const n = nextYM(y, m);
    const end = num({ y: n[0], m: n[1], d: 1 }) + 9;
    const v = num(x);
    return v >= start && v <= end;
  }
  function repair(x, y, m) {
    const cands = [x];
    const sw = mk(x.y, x.d, x.m); // swapped day/month
    if (sw) cands.push(sw);
    cands.slice().forEach(function (c) {
      [-1, 1].forEach(function (dy) { const z = mk(c.y + dy, c.m, c.d); if (z) cands.push(z); });
    });
    for (let i = 0; i < cands.length; i++) if (inWindow(cands[i], y, m)) return cands[i];
    return null;
  }

  function isStr(v) { return typeof v === 'string'; }
  function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
  function norm(v) {
    if (isStr(v)) { v = v.trim(); return v === '' ? null : v; }
    return v === '' || v === undefined ? null : v;
  }
  function lower(v) { return isStr(v) ? v.toLowerCase() : null; }
  function dateOf(v) {
    const p = Utilities.formatDate(v, tz, 'yyyy-M-d').split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }
  function monthOfLabel(v) {
    if (isDate(v)) return dateOf(v).m;
    if (isStr(v)) {
      const s = v.trim().toLowerCase();
      if (/^[a-z]+$/.test(s) && MONTHS[s.slice(0, 3)]) return MONTHS[s.slice(0, 3)];
    }
    return null;
  }
  function parseDate(v, year) {
    if (isDate(v)) return dateOf(v);
    if (typeof v === 'number' && v > 1 && v < 60000) return fromNum(Math.round(v) - 25569);
    if (!isStr(v)) return null;
    const s = v.trim().toLowerCase().replace(/,/g, ' ');
    let mt = s.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?\s*([a-z]+)\.?(?:\s+(\d{2,4}))?$/);
    if (mt) {
      const mon = MONTHS[mt[2].slice(0, 3)] || MONTHS[mt[2].slice(0, 2)];
      if (mon) {
        let y = mt[3] ? Number(mt[3]) : year;
        if (y < 100) y += 2000;
        return mk(y, mon, Number(mt[1]));
      }
    }
    mt = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
    if (mt) {
      const a = Number(mt[1]), b = Number(mt[2]);
      let y = mt[3] ? Number(mt[3]) : year;
      if (y < 100) y += 2000;
      return mk(y, b, a) || mk(y, a, b); // SA style d/m first
    }
    return null;
  }
  function amount(v) {
    if (typeof v === 'number') return v;
    if (isStr(v)) {
      const s = v.replace(/[Rr\s]/g, '').replace(',', '.');
      if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    }
    return null;
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[^a-zà-ÿ])([a-zà-ÿ])/g, function (_, p, c) { return p + c.toUpperCase(); });
  }
  function fixName(n) {
    if (!n) return 'Chrisilda';
    n = titleCase(n.trim());
    return { Chrisiilda: 'Chrisilda', Silla: 'Chrisilda' }[n] || n;
  }
  function isName(v) {
    return isStr(v) && v && !monthOfLabel(v) && !HEADER_WORDS[v.toLowerCase()] && !/^\d/.test(v);
  }
  function cmpTuple(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  // Prepare grids (skip the expenses tab).
  const sheets = tabs
    .filter(function (t) { return !/^expen/i.test(t.title); })
    .map(function (t) {
      const yr = t.title.trim().match(/(\d{2})\s*$/);
      let grid = t.values.map(function (r) { return r.map(norm).concat([null, null, null]); });
      const W = grid.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
      grid = grid.map(function (r) { while (r.length < W) r.push(null); return r; });
      const blank = []; for (let i = 0; i < W; i++) blank.push(null);
      grid.push(blank);
      return { title: t.title, year: 2000 + Number(yr ? yr[1] : 0), grid: grid };
    });

  // Names per column block, to fill blocks where the name was left out.
  const seen = [];
  sheets.forEach(function (sh, ti) {
    const g = sh.grid;
    const hdrs = [];
    g.forEach(function (row, r) { if (row.map(lower).indexOf('client') >= 0) hdrs.push(r); });
    hdrs.forEach(function (hr, hi) {
      const low = g[hr].map(lower);
      const lab = g[hr + 1] || [];
      let gi = 0;
      low.forEach(function (v, cc) {
        if (v !== 'client') return;
        let nm = null;
        for (let c = cc - 1; c < Math.min(cc + 6, lab.length); c++) {
          if (c >= 0 && isName(lab[c])) { nm = lab[c]; break; }
        }
        seen.push({ ti: ti, title: sh.title, hi: hi, gi: gi, name: nm });
        gi++;
      });
    });
  });
  const NAMES = {};
  seen.forEach(function (s, i) {
    if (s.name) return;
    const later = seen.slice(i + 1).filter(function (x) { return x.ti === s.ti && x.gi === s.gi && x.name; });
    const newer = seen.slice(0, i).reverse().filter(function (x) { return x.ti < s.ti && x.gi === s.gi && x.name; });
    const pick = later[0] || newer[0];
    if (pick) NAMES[s.title + '|' + s.hi + '|' + s.gi] = pick.name;
  });

  const out = [];
  const posName = {};
  const prevYM = {};

  sheets.forEach(function (sh) {
    const grid = sh.grid, R = grid.length, tabYear = sh.year, title = sh.title;
    const headers = [];
    grid.forEach(function (row, r) {
      const low = row.map(lower);
      if (low.indexOf('client') >= 0 && (low.indexOf('cash') >= 0 || low.indexOf('eft') >= 0)) headers.push(r);
    });
    const prevMonth = {};
    // Data above the first header (the first month of a tab) uses the first header's layout.
    const blocks = headers.map(function (hr) { return { hr: hr, start: hr, virtual: false }; });
    if (headers.length && headers[0] > 2) blocks.unshift({ hr: headers[0], start: 0, virtual: true });
    const offset = blocks.length && blocks[0].virtual ? 1 : 0;

    blocks.forEach(function (blk, hi) {
      const hr = blk.hr, start = blk.start, virtual = blk.virtual;
      const end = hi + 1 < blocks.length ? blocks[hi + 1].start : R;
      const low = grid[hr].map(lower);
      const clientCols = [];
      low.forEach(function (v, c) { if (v === 'client') clientCols.push(c); });

      clientCols.forEach(function (cc, gi) {
        const nxt = gi + 1 < clientCols.length ? clientCols[gi + 1] : low.length;
        const cols = {};
        for (let c = cc; c < Math.min(nxt, cc + 6); c++) {
          const k = KEYS[(low[c] || '').trim()];
          if (k && cols[k] === undefined) cols[k] = c;
        }
        cols.date = cc - 1;
        // Some headers are shifted one column left (Client written above the dates).
        let dateLike = 0;
        for (let r = start + 2; r < Math.min(start + 8, R); r++) {
          const v = grid[r][cc];
          if (isDate(v) || (isStr(v) && parseDate(v, tabYear))) dateLike++;
        }
        if (dateLike >= 2) {
          cols.date = cc; cols.client = cc + 1; delete cols.service;
          log.push(title + ' r' + (hr + 1) + ': shifted header fixed');
        }
        const methodCols = METHOD_KEYS.filter(function (k) { return cols[k] !== undefined; });
        if (!methodCols.length) return;
        const paidCol = Math.max.apply(null, methodCols.map(function (k) { return cols[k]; })) + 1;
        const gFrom = Math.max(cols.date, 0);

        // Label row: employee name + month.
        const lab = virtual ? [] : grid[hr + 1];
        let name = null, labelM = null;
        for (let c = gFrom; c <= paidCol; c++) {
          const v = lab[c];
          const lm = v === undefined ? null : monthOfLabel(v);
          if (lm && labelM === null) labelM = lm;
          else if (!lm && isName(v)) name = name || v;
        }
        const firstData = virtual ? start : (name || labelM ? hr + 2 : hr + 1);
        if (name) posName[title + '|' + gi] = name;
        else if (gi > 0) name = posName[title + '|' + gi] || NAMES[title + '|' + (hi - offset) + '|' + gi] || 'Unknown ' + gi;
        const emp = fixName(name);
        if (labelM === null && prevMonth[emp]) labelM = prevMonth[emp] % 12 + 1;

        // Collect rows, split into month segments at "1st of the month" marker rows.
        const segs = [{ label: labelM, rows: [] }];
        let curDate = null, curClient = '', inTotals = false;
        for (let r = firstData; r < end; r++) {
          const row = grid[r];
          let client = row[cols.client];
          let stop = false;
          for (let c = gFrom; c <= paidCol; c++) if (isStr(row[c]) && STOP.test(row[c])) { stop = true; break; }
          if (stop) { inTotals = true; curClient = ''; continue; }
          const raw = cols.date >= 0 ? row[cols.date] : null;
          const amts = [];
          METHOD_KEYS.forEach(function (k) {
            if (cols[k] === undefined) return;
            const a = amount(row[cols[k]]);
            if (a) amts.push([k, a]);
          });
          let svc = cols.service !== undefined ? row[cols.service] : '';
          if (isDate(svc)) svc = '';
          const d = raw !== null ? parseDate(raw, tabYear) : null;
          if (d && d.d === 1 && !client && !amts.length && !svc) {
            segs.push({ label: d.m, rows: [] });
            inTotals = false; curDate = null; curClient = '';
            continue;
          }
          if (raw !== null) {
            if (d) { curDate = { d: d, raw: raw }; inTotals = false; }
            else if (!(isStr(raw) && monthOfLabel(raw))) log.push(title + ' r' + (r + 1) + ' ' + emp + ': unreadable date ' + JSON.stringify(raw));
          }
          if (inTotals) continue;
          if (isStr(client) && client) {
            curClient = client;
          } else if (amts.length) {
            if (!svc) { log.push(title + ' r' + (r + 1) + ' ' + emp + ': skipped amount with no client ' + JSON.stringify(amts)); continue; }
            client = curClient;
          }
          if (!amts.length) continue;
          if (!curDate) { log.push(title + ' r' + (r + 1) + ' ' + emp + ': skipped amount with no date ' + JSON.stringify(amts)); continue; }
          const paid = row[paidCol] !== null && row[paidCol] !== 0;
          amts.forEach(function (ka) {
            if (ka[1] > 5000 || ka[1] < 0) {
              log.push(title + ' r' + (r + 1) + ' ' + emp + ': skipped unusual amount ' + ka[0] + ' ' + ka[1] + ' (' + (client || '') + ' ' + (svc || '') + ')');
              return;
            }
            segs[segs.length - 1].rows.push({
              raw: curDate, r: r, client: String(client || '').trim(), service: String(svc || '').trim(),
              method: ka[0], amount: Math.round(ka[1] * 100) / 100, paid: paid,
            });
          });
        }

        // Work out each appointment's business month.
        segs.forEach(function (seg) {
          const rows = seg.rows;
          const lm = seg.label || labelM;
          if (!rows.length) return;
          const head = rows.slice(0, 40);
          const score = function (y, m) { return head.filter(function (x) { return inWindow(x.raw.d, y, m); }).length; };
          const p0 = period(rows[0].raw.d);
          const cand = [[score(p0[0], p0[1]), 0, p0[0], p0[1]]];
          if (lm) {
            [tabYear, tabYear - 1, tabYear + 1].forEach(function (y) {
              cand.push([score(y, lm), 1 - Math.abs(y - tabYear) * 2, y, lm]);
            });
          }
          if (prevYM[emp]) {
            const n = nextYM(prevYM[emp][0], prevYM[emp][1]);
            cand.push([score(n[0], n[1]), 1, n[0], n[1]]);
          }
          cand.sort(cmpTuple);
          let y = cand[cand.length - 1][2], m = cand[cand.length - 1][3];
          let lastD = null;
          rows.forEach(function (x, i) {
            const rawD = x.raw.d;
            const ahead = rows.slice(i + 1, i + 4).map(function (z) { return z.raw.d; })
              .filter(function (z) { return num(z) !== num(rawD); });
            const look = ahead.length ? ahead : [rawD];
            const confirmed = look.filter(function (z) { return !inWindow(z, y, m) || num(z) >= num(rawD); }).length >=
              Math.max(1, look.length - 1);
            let d = inWindow(rawD, y, m) ? rawD : null;
            if (!d) {
              const n = nextYM(y, m);
              const fixed = repair(rawD, y, m);
              const monthStart = num({ y: y, m: m, d: 1 });
              if (inWindow(rawD, n[0], n[1]) && num(rawD) > monthStart && confirmed) {
                y = n[0]; m = n[1]; d = rawD;
              } else if (fixed) {
                d = fixed;
                log.push(title + ' r' + (x.r + 1) + ' ' + emp + ': date ' + iso(rawD) + ' fixed to ' + iso(d));
              } else if (num(rawD) > monthStart && num(rawD) < monthStart + 100 && confirmed) {
                const p = rawD.d >= startDay ? period(rawD) : [rawD.y, rawD.m];
                y = p[0]; m = p[1]; d = rawD;
              } else if (rawD.y <= 1900) {
                // only a day number was typed in the date column
                const day = rawD.y === 1900 ? num(rawD) - num({ y: 1899, m: 12, d: 30 }) : 1;
                d = mk(y, m, day) || lastD || mk(y, m, 1);
                log.push(title + ' r' + (x.r + 1) + ' ' + emp + ': day-only date ' + JSON.stringify(x.raw.raw) + ' → ' + iso(d));
              } else if (Math.abs(rawD.y - tabYear) > 1) {
                d = lastD || mk(y, m, 1);
                log.push(title + ' r' + (x.r + 1) + ' ' + emp + ': nonsense date ' + JSON.stringify(x.raw.raw) + ' → ' + iso(d));
              } else {
                d = rawD;
                log.push(title + ' r' + (x.r + 1) + ' ' + emp + ': date ' + iso(rawD) + ' looks wrong for ' + ymStr(y, m) + '; kept');
              }
            }
            prevMonth[emp] = m;
            prevYM[emp] = [y, m];
            lastD = d;
            out.push({
              date: iso(d), month: ymStr(y, m), employee: emp, client: x.client, service: x.service,
              amount: x.amount, method: x.method, paidMark: x.paid, tab: title, row: x.r + 1,
            });
          });
        });
      });
    });
  });

  const employees = {};
  out.forEach(function (a) { employees[a.employee] = true; });
  return { appointments: out, employees: employees, log: log };
}
