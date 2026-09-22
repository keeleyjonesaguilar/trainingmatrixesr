-- Lets an admin manually add a missed attendee's name to a session's roster AFTER the trainer
-- has already closed it (Keeley's request, 2026-09-22) - today the roster locks at close with no
-- way back in. A manually-added attendee didn't necessarily sign anything live, so `signature`
-- (previously NOT NULL - every attendee signed at the kiosk) has to become optional; every place
-- that reads it already has to handle "no signature" gracefully for other reasons, so this is a
-- pure relaxation, not a behavior change for existing rows.
ALTER TABLE session_attendees ALTER COLUMN signature DROP NOT NULL;

-- Marks a row added this way rather than through the real kiosk sign-in flow, so the roster can
-- show it was backfilled by an admin rather than implying the person was physically present and
-- signed in on their own.
ALTER TABLE session_attendees ADD COLUMN added_by_admin INTEGER NOT NULL DEFAULT 0;
