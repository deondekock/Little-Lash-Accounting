-- Clients' cell numbers (for WhatsApp reminders), one row per client name key (see clientKey in src/lib/stats.js).
CREATE TABLE IF NOT EXISTS client_info (
  id TEXT PRIMARY KEY, name TEXT, phone TEXT, created_at TEXT, updated_at TEXT, updated_by TEXT
);
-- Owners can get a daily or weekly summary: '' (off) | 'daily' | 'weekly'.
ALTER TABLE notify_prefs ADD COLUMN summary TEXT;
