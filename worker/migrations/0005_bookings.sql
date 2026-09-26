-- Online booking: service durations and who does what, working hours, bookings, client accounts.
ALTER TABLE services ADD COLUMN minutes INTEGER;        -- usual length
ALTER TABLE services ADD COLUMN durations TEXT;         -- JSON { employeeId: minutes } when someone takes longer/shorter
ALTER TABLE services ADD COLUMN staff TEXT;             -- JSON [employeeId…] who does it (for online booking)
ALTER TABLE services ADD COLUMN online INTEGER NOT NULL DEFAULT 0;  -- clients can book it themselves
ALTER TABLE services ADD COLUMN category TEXT;
ALTER TABLE services ADD COLUMN description TEXT;
ALTER TABLE employees ADD COLUMN schedule TEXT;         -- JSON working hours { "1": [["08:00","17:00"]], … } (0 = Sunday)
ALTER TABLE appointments ADD COLUMN client_id TEXT;     -- the client's online account, when known
ALTER TABLE appointments ADD COLUMN booking_id TEXT;    -- the booking it came from
CREATE INDEX appointments_client ON appointments (client_id);

CREATE TABLE clients (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, notes TEXT,
  client_key TEXT,                                      -- her name as used on past appointments (linked by the owner)
  created_at TEXT, updated_at TEXT, last_login_at TEXT
);
CREATE UNIQUE INDEX clients_email ON clients (email);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, start TEXT NOT NULL, minutes INTEGER NOT NULL,
  employee_id TEXT, client_id TEXT, client_name TEXT, client_phone TEXT,
  services TEXT,                                        -- JSON [{ id, name, price, minutes }]
  status TEXT NOT NULL DEFAULT 'booked',                -- booked | done | cancelled | noshow
  kind TEXT NOT NULL DEFAULT 'booking',                 -- booking | block (time off, lunch…)
  notes TEXT, source TEXT,                              -- online | salon
  appointment_id TEXT, reminded_at TEXT,
  created_by TEXT, updated_by TEXT, created_at TEXT, updated_at TEXT
);
CREATE INDEX bookings_date ON bookings (date);
CREATE INDEX bookings_client ON bookings (client_id);

-- One-time sign-in codes for clients (email + 6 digits).
CREATE TABLE login_codes (email TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER, sends INTEGER, window_start INTEGER);
