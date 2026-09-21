-- More AHA Heartsaver Course Roster fields (Keeley's request, 2026-09-21, same session as
-- 051_aha_heartsaver_roster.sql): the page-3 Optional Topics Checklist (a per-session checklist,
-- not per-attendee - stored as a JSON array of server/lib/ahaOptionalTopics.js keys), and the
-- optional Assisting Instructor grid (up to 8 entries, JSON array of {name_id, card_exp_date}).
ALTER TABLE training_sessions ADD COLUMN hs_optional_topics TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_additional_instructors TEXT;
