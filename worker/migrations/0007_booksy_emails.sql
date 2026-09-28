-- Booksy's notification emails, read from the connected Gmail account: one row per email.
CREATE TABLE IF NOT EXISTS booksy_emails (
  id TEXT PRIMARY KEY,          -- Gmail message id
  received_at TEXT,             -- when the email arrived (ISO)
  subject TEXT, from_addr TEXT, body TEXT,
  kind TEXT,                    -- 'new' | 'cancelled' | 'moved' | 'other' (from the parser)
  data TEXT,                    -- what the parser found (JSON: client, service, date, time, staff, price)
  appointment_id TEXT,          -- the payment recorded from it
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS booksy_emails_received ON booksy_emails (received_at);
