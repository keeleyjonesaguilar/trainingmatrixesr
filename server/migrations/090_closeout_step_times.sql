-- When and by whom each close-out step was done (Keeley, 2026-11-03): the session page shows Sent
-- to Client and Sent to Trainees as steps with a date and a name instead of bare checkboxes.
-- Sessions already ticked get the certificate email time where there is one; a step ticked by
-- hand before today has no time on file and just shows as done.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS sent_to_client_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS sent_to_client_by TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS sent_to_trainees_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS sent_to_trainees_by TEXT;
UPDATE training_sessions SET sent_to_client_at = certificates_emailed_to_client_at
WHERE sent_to_client = 1 AND sent_to_client_at IS NULL AND certificates_emailed_to_client_at IS NOT NULL;
UPDATE training_sessions ts SET sent_to_trainees_at = (
  SELECT MAX(sa.certificate_emailed_at) FROM session_attendees sa WHERE sa.session_id = ts.session_id
)
WHERE sent_to_trainees = 1 AND sent_to_trainees_at IS NULL;
