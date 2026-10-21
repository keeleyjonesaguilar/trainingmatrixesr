-- "Sent to Trainees" alongside Sent to Client (Keeley's request, 2026-10-21): the Training
-- Sessions list shows sent to the client, the trainees, or both. Ticked on the session page or
-- automatically when certificates are emailed to employees; sessions already emailed count now.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS sent_to_trainees INTEGER NOT NULL DEFAULT 0;
UPDATE training_sessions ts SET sent_to_trainees = 1
WHERE sent_to_trainees = 0
  AND EXISTS (SELECT 1 FROM session_attendees sa WHERE sa.session_id = ts.session_id AND sa.certificate_emailed_at IS NOT NULL);
