-- Payments toward appointments: partial settlements, split tenders (EFT deposit + card), and later
-- voucher redemptions. An appointment with no payment rows keeps its old meaning (Paid = full amount
-- collected, Unpaid = nothing), so existing data is unchanged; rows are only added for partial/split.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  voucher_id TEXT,
  note TEXT,
  created_at TEXT,
  updated_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX payments_appointment ON payments (appointment_id);
