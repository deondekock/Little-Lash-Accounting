-- Vouchers expire (a year after purchase unless chosen otherwise). expiry_note records any later change
-- to the expiry date (who, when, from → to) so an extended voucher is clearly marked.
ALTER TABLE vouchers ADD COLUMN expires_on TEXT;
ALTER TABLE vouchers ADD COLUMN expiry_note TEXT;
