-- Class details request (Keeley, 2026-11-16: "When we create the training, can it auto send the
-- request for class details to Jayna or Guy?? and then when they complete it, it gets attached to
-- that training session"). Every new training (not toolbox talks) emails the people below a link
-- to the session's Class Needs card; saving it marks the request done and bells the office. No
-- review step (the 10/07 prep workflow with one was rolled back).

-- More Class Needs fields - all optional.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_student_count INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_room_layout TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_site_contact_name TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_site_contact_phone TEXT;

-- The request: when it went out and to whom (names), and when/who filled it in.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_requested_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_requested_to TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_completed_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_completed_by TEXT;

-- Who gets the request - on/off per user on Manage Users, like gets_session_emails. Its own column
-- (not 076's unused gets_prep_requests, whose values went stale) - Guy and Jayna to start.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS gets_class_needs_requests INTEGER NOT NULL DEFAULT 0;
UPDATE app_users SET gets_class_needs_requests = 1 WHERE LOWER(email) IN ('guy@esr-safety.com', 'jayna@esr-safety.com');
