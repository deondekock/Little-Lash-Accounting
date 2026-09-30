-- Gift vouchers. Sold one month (cash in now, for a future visit), redeemed later — possibly by a
-- different person — as a "Voucher" tender on the payments ledger. balance tracks part-used vouchers.
CREATE TABLE vouchers (
  id TEXT PRIMARY KEY,
  code TEXT,
  amount REAL NOT NULL,
  balance REAL NOT NULL,
  buyer TEXT,
  buyer_key TEXT,
  sold_on TEXT,
  method TEXT,
  status TEXT,
  note TEXT,
  created_at TEXT,
  updated_at TEXT,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX vouchers_status ON vouchers (status);
