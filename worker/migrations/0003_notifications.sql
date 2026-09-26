-- Notifications: who wants email, which phones get push, and the server's own settings
-- (push keys, email relay link) — never sent to the app.
CREATE TABLE notify_prefs (email TEXT PRIMARY KEY, email_on INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY, email TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT
);
CREATE INDEX push_subscriptions_email ON push_subscriptions (email);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);
