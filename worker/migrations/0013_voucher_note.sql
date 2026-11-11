-- A line printed on the voucher image itself (e.g. "Any full set of lash extensions"), separate from
-- the salon's own private note.
ALTER TABLE vouchers ADD COLUMN voucher_note TEXT;
