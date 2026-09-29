-- A note that dismisses a client from the "gone quiet" win-back list (e.g. moved away, passed away),
-- so the list stays focused on clients who left for no known reason. NULL = still on the list.
ALTER TABLE client_info ADD COLUMN quiet_note TEXT;
