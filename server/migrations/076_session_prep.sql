-- Session prep (Keeley's request, 2026-10-07): a session taught by one of our own trainers gets a
-- prep step after it's created. The prep team (Guy, Jayna) is emailed to fill in the class details
-- below; the reviewers (Emily, Keeley) are emailed when that's done, check it, and send the trainer(s)
-- a summary. Sessions with an outside trainer, toolbox talks, and every session created before this
-- have prep_status NULL - no prep step.
--   prep_status: 'info_needed' (Additional info needed) -> 'ready_to_send' -> 'sent'
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS wetransfer_link TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_status TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_student_count INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_room_layout TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_av_connection TEXT;   -- 'yes' / 'no'
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_completed_by TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_completed_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_sent_by TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS prep_sent_at TEXT;

-- Who gets which prep email - on/off per user on Manage Users, like gets_session_emails, so new
-- staff can be added later without code changes.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gets_prep_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gets_prep_review INTEGER NOT NULL DEFAULT 0;
UPDATE app_users SET gets_prep_requests = 1 WHERE LOWER(email) IN ('guy@esr-safety.com', 'jayna@esr-safety.com');
UPDATE app_users SET gets_prep_review = 1 WHERE LOWER(email) IN ('emily@esr-safety.com', 'keeley@esr-safety.com');
