-- Secret per-session token behind the trainer's "Edit close-out details" link in the close-out
-- email (Keeley's request, 2026-09-24: e.g. filling in an address that wasn't known at close-out,
-- or removing a duplicate sign-in). Kept separate from qr_token - the sign-in link printed on the
-- QR code - so knowing the sign-in link never grants edit access. Set when a session closes;
-- sessions closed before this get one the first time an admin copies the edit link.
ALTER TABLE training_sessions ADD COLUMN edit_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_sessions_edit_token ON training_sessions(edit_token);
