-- Who added / last changed each appointment (staff can now add their own).
ALTER TABLE appointments ADD COLUMN created_by TEXT;
ALTER TABLE appointments ADD COLUMN updated_by TEXT;
