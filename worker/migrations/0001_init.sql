-- Little Lash Lounge: the salon's data (appointments, team, services, leave, payslips).
CREATE TABLE employees (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, active INTEGER NOT NULL DEFAULT 1,
  pay TEXT, -- payslip details as JSON
  created_at TEXT, updated_at TEXT
);
CREATE TABLE appointments (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, month TEXT NOT NULL, employee_id TEXT, employee_name TEXT,
  client TEXT, service TEXT, amount REAL NOT NULL DEFAULT 0, method TEXT, status TEXT, paid_on TEXT, notes TEXT,
  overtime TEXT, length INTEGER, created_at TEXT, updated_at TEXT
);
CREATE INDEX appointments_month ON appointments (month);
CREATE INDEX appointments_employee ON appointments (employee_id);
CREATE TABLE services (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL, active INTEGER NOT NULL DEFAULT 1,
  prices TEXT, -- JSON { employeeId: price }
  created_at TEXT, updated_at TEXT
);
CREATE TABLE leave (
  id TEXT PRIMARY KEY, employee_id TEXT, employee_name TEXT, type TEXT, from_date TEXT, to_date TEXT,
  hours REAL, notes TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE payslips (
  id TEXT PRIMARY KEY, employee_id TEXT, employee_name TEXT, month TEXT, pay_date TEXT,
  gross REAL, paye REAL, uif REAL, deductions REAL, net REAL,
  details TEXT, -- the whole payslip as JSON
  created_at TEXT, updated_at TEXT
);
CREATE INDEX payslips_month ON payslips (month);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE history (
  id TEXT PRIMARY KEY, time TEXT NOT NULL, who TEXT, action TEXT, summary TEXT, undone_at TEXT,
  data TEXT -- the records as they were before the change (JSON), for undo
);
CREATE INDEX history_time ON history (time);
