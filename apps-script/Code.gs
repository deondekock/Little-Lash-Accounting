/**
 * Little Lash Lounge — employee appointment payments tracker.
 *
 * A Google Apps Script web app (free, hosted by Google). All data is stored in
 * a Google Sheet in the signed-in user's own Google Drive. The sheet is created
 * automatically the first time the app is opened.
 */

const APP_NAME = 'Little Lash Lounge Payments';
const METHODS = ['Cash', 'Card', 'EFT'];
const STATUSES = ['Paid', 'Unpaid'];

const EMPLOYEES = 'Employees';
const APPOINTMENTS = 'Appointments';

const EMPLOYEE_HEADERS = ['ID', 'Name', 'Phone', 'Active', 'Created At', 'Updated At'];
const APPOINTMENT_HEADERS = [
  'ID', 'Date', 'Month', 'Employee ID', 'Employee', 'Client', 'Service',
  'Amount', 'Method', 'Status', 'Paid On', 'Notes', 'Created At', 'Updated At',
];

// Zero-based column indexes into APPOINTMENT_HEADERS.
const A = {
  ID: 0, DATE: 1, MONTH: 2, EMPLOYEE_ID: 3, EMPLOYEE: 4, CLIENT: 5, SERVICE: 6,
  AMOUNT: 7, METHOD: 8, STATUS: 9, PAID_ON: 10, NOTES: 11, CREATED: 12, UPDATED: 13,
};
// Zero-based column indexes into EMPLOYEE_HEADERS.
const E = { ID: 0, NAME: 1, PHONE: 2, ACTIVE: 3, CREATED: 4, UPDATED: 5 };

// Columns that must be stored as plain text so Sheets doesn't turn them into dates/numbers.
const APPOINTMENT_TEXT_COLS = [A.DATE, A.MONTH, A.PAID_ON, A.CREATED, A.UPDATED];
const EMPLOYEE_TEXT_COLS = [E.PHONE, E.CREATED, E.UPDATED];

let spreadsheet_ = null;

/* ------------------------------------------------------------------ */
/* Web app entry point                                                 */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/* ------------------------------------------------------------------ */
/* Public API (called from Index.html via google.script.run)           */
/* ------------------------------------------------------------------ */

function getInitialData() {
  const ss = getSpreadsheet_();
  return {
    employees: listEmployees_(),
    spreadsheetUrl: ss.getUrl(),
    user: Session.getActiveUser().getEmail(),
    methods: METHODS,
  };
}

function saveEmployee(input) {
  return withLock_(function () {
    const name = clean_(input && input.name);
    if (!name) throw new Error('Please enter the employee\'s name.');
    const phone = clean_(input.phone);
    const sheet = getSheet_(EMPLOYEES);
    const now = new Date().toISOString();

    if (input.id) {
      const rowNum = findRow_(sheet, input.id);
      if (!rowNum) throw new Error('Employee not found.');
      const row = sheet.getRange(rowNum, 1, 1, EMPLOYEE_HEADERS.length).getValues()[0];
      const oldName = row[E.NAME];
      row[E.NAME] = name;
      row[E.PHONE] = phone;
      row[E.ACTIVE] = input.active !== false;
      row[E.UPDATED] = now;
      writeRow_(sheet, rowNum, row, EMPLOYEE_TEXT_COLS);
      if (oldName !== name) renameInAppointments_(input.id, name);
    } else {
      const row = [Utilities.getUuid(), name, phone, true, now, now];
      writeRow_(sheet, sheet.getLastRow() + 1, row, EMPLOYEE_TEXT_COLS);
    }
    return listEmployees_();
  });
}

function deleteEmployee(id) {
  return withLock_(function () {
    const used = readAppointments_().some(function (a) { return a.employeeId === id; });
    if (used) {
      throw new Error('This employee has appointments. Mark her as inactive instead of deleting.');
    }
    const sheet = getSheet_(EMPLOYEES);
    const rowNum = findRow_(sheet, id);
    if (rowNum) sheet.deleteRow(rowNum);
    return listEmployees_();
  });
}

/** period is 'YYYY-MM' (one month) or 'YYYY' (whole year). */
function getAppointments(period) {
  period = String(period || '');
  if (!/^\d{4}(-\d{2})?$/.test(period)) throw new Error('Invalid period: ' + period);
  return readAppointments_().filter(function (a) { return a.date.indexOf(period) === 0; });
}

function saveAppointment(input) {
  return withLock_(function () {
    const sheet = getSheet_(APPOINTMENTS);
    const employees = listEmployees_();
    const now = new Date().toISOString();
    let rowNum = null;
    let existing = null;

    if (input && input.id) {
      rowNum = findRow_(sheet, input.id);
      if (!rowNum) throw new Error('Appointment not found.');
      existing = sheet.getRange(rowNum, 1, 1, APPOINTMENT_HEADERS.length).getValues()[0];
    }

    const a = validateAppointment_(input, employees);
    const paidOn = a.status === 'Paid'
      ? (existing && existing[A.STATUS] === 'Paid' && toText_(existing[A.PAID_ON])) || today_()
      : '';

    const row = [
      existing ? existing[A.ID] : Utilities.getUuid(),
      a.date, a.date.slice(0, 7), a.employeeId, a.employeeName, a.client, a.service,
      a.amount, a.method, a.status, paidOn, a.notes,
      existing ? toText_(existing[A.CREATED]) : now, now,
    ];
    writeRow_(sheet, rowNum || sheet.getLastRow() + 1, row, APPOINTMENT_TEXT_COLS);
    sheet.getRange(rowNum || sheet.getLastRow(), A.AMOUNT + 1).setNumberFormat('"R "#,##0.00');
    return rowToAppointment_(row);
  });
}

/** Bulk-change status and/or method on several appointments at once. */
function updateAppointments(ids, changes) {
  return withLock_(function () {
    changes = changes || {};
    if (changes.status && STATUSES.indexOf(changes.status) < 0) throw new Error('Invalid status.');
    if (changes.method && METHODS.indexOf(changes.method) < 0) throw new Error('Invalid payment method.');

    const sheet = getSheet_(APPOINTMENTS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const n = lastRow - 1;
    const idCol = sheet.getRange(2, 1, n, 1).getValues();
    // Method, Status, Paid On are adjacent columns.
    const payRange = sheet.getRange(2, A.METHOD + 1, n, 3);
    const pay = payRange.getValues();
    const updRange = sheet.getRange(2, A.UPDATED + 1, n, 1);
    const upd = updRange.getValues();

    const wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    const now = new Date().toISOString();
    const today = today_();
    const changedRows = [];

    for (let i = 0; i < n; i++) {
      if (!wanted[idCol[i][0]]) continue;
      if (changes.method) pay[i][0] = changes.method;
      if (changes.status) {
        if (changes.status === 'Paid' && pay[i][1] !== 'Paid') pay[i][2] = today;
        if (changes.status === 'Unpaid') pay[i][2] = '';
        pay[i][1] = changes.status;
      }
      upd[i][0] = now;
      changedRows.push(i);
    }
    if (!changedRows.length) return [];

    sheet.getRange(2, A.PAID_ON + 1, n, 1).setNumberFormat('@');
    updRange.setNumberFormat('@');
    payRange.setValues(pay);
    updRange.setValues(upd);

    const all = sheet.getRange(2, 1, n, APPOINTMENT_HEADERS.length).getValues();
    return changedRows.map(function (i) { return rowToAppointment_(all[i]); });
  });
}

function deleteAppointment(id) {
  return withLock_(function () {
    const sheet = getSheet_(APPOINTMENTS);
    const rowNum = findRow_(sheet, id);
    if (rowNum) sheet.deleteRow(rowNum);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Spreadsheet helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Returns the data spreadsheet. Order of preference:
 *  1. Script property SPREADSHEET_ID (use one fixed sheet for everyone).
 *  2. The spreadsheet this user has used before (remembered per user).
 *  3. A brand-new spreadsheet created in the user's Google Drive.
 */
function getSpreadsheet_() {
  if (spreadsheet_) return spreadsheet_;

  const fixedId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (fixedId) return (spreadsheet_ = SpreadsheetApp.openById(fixedId));

  const props = PropertiesService.getUserProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return (spreadsheet_ = SpreadsheetApp.openById(id));
    } catch (e) {
      // The sheet was deleted or access was lost — fall through and create a new one.
    }
  }

  spreadsheet_ = SpreadsheetApp.create(APP_NAME);
  props.setProperty('SPREADSHEET_ID', spreadsheet_.getId());
  getSheet_(EMPLOYEES);
  getSheet_(APPOINTMENTS);
  return spreadsheet_;
}

function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  const headers = name === EMPLOYEES ? EMPLOYEE_HEADERS : APPOINTMENT_HEADERS;
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f6e3ea');
  sheet.setFrozenRows(1);

  // Remove the empty default sheet that SpreadsheetApp.create() adds.
  ss.getSheets().forEach(function (s) {
    if (s.getName() !== EMPLOYEES && s.getName() !== APPOINTMENTS && s.getLastRow() === 0 &&
        ss.getSheets().length > 1) {
      ss.deleteSheet(s);
    }
  });
  return sheet;
}

function writeRow_(sheet, rowNum, values, textCols) {
  textCols.forEach(function (c) { sheet.getRange(rowNum, c + 1).setNumberFormat('@'); });
  sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
}

function findRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !id) return null;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return null;
}

function readRows_(name, width) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, width).getValues()
    .filter(function (r) { return r[0] !== ''; });
}

function listEmployees_() {
  return readRows_(EMPLOYEES, EMPLOYEE_HEADERS.length)
    .map(function (r) {
      return {
        id: String(r[E.ID]),
        name: String(r[E.NAME]),
        phone: toText_(r[E.PHONE]),
        active: r[E.ACTIVE] === true || String(r[E.ACTIVE]).toUpperCase() === 'TRUE',
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function readAppointments_() {
  return readRows_(APPOINTMENTS, APPOINTMENT_HEADERS.length).map(rowToAppointment_);
}

function rowToAppointment_(r) {
  return {
    id: String(r[A.ID]),
    date: toText_(r[A.DATE]),
    employeeId: String(r[A.EMPLOYEE_ID]),
    employeeName: String(r[A.EMPLOYEE]),
    client: String(r[A.CLIENT]),
    service: String(r[A.SERVICE]),
    amount: Number(r[A.AMOUNT]) || 0,
    method: String(r[A.METHOD]),
    status: String(r[A.STATUS]) === 'Paid' ? 'Paid' : 'Unpaid',
    paidOn: toText_(r[A.PAID_ON]),
    notes: String(r[A.NOTES]),
  };
}

function renameInAppointments_(employeeId, name) {
  const sheet = getSheet_(APPOINTMENTS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, A.EMPLOYEE_ID + 1, lastRow - 1, 2);
  const values = range.getValues();
  let changed = false;
  values.forEach(function (v) {
    if (v[0] === employeeId && v[1] !== name) { v[1] = name; changed = true; }
  });
  if (changed) range.setValues(values);
}

function validateAppointment_(input, employees) {
  input = input || {};
  const date = clean_(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Please choose a valid date.');

  const employee = employees.filter(function (e) { return e.id === input.employeeId; })[0];
  if (!employee) throw new Error('Please choose an employee.');

  const amount = Math.round(parseFloat(String(input.amount).replace(',', '.')) * 100) / 100;
  if (!isFinite(amount) || amount < 0) throw new Error('Please enter a valid amount.');

  const method = METHODS.indexOf(input.method) >= 0 ? input.method : null;
  if (!method) throw new Error('Please choose Cash, Card or EFT.');

  return {
    date: date,
    employeeId: employee.id,
    employeeName: employee.name,
    client: clean_(input.client),
    service: clean_(input.service),
    amount: amount,
    method: method,
    status: input.status === 'Paid' ? 'Paid' : 'Unpaid',
    notes: clean_(input.notes),
  };
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function clean_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function toText_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return clean_(v);
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
