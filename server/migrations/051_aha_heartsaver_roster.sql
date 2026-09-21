-- Fields for the official AHA Heartsaver Course Roster PDF (Keeley's request, 2026-09-21) -
-- filled in by the trainer at close-out, shown only for First Aid/CPR/AED (TRN-020) sessions.
-- hs_course_options stores the selected checkbox keys from server/lib/ahaCourseOptions.js as a
-- JSON array (e.g. ["heartsaver_cpr_aed","child_cpr_aed"]) - free text everywhere else, matching
-- the blank-line fields on the original form (no reason to parse/validate a date the form itself
-- treats as a plain line).
ALTER TABLE training_sessions ADD COLUMN hs_course_options TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_training_center TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_training_center_id TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_training_site_name TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_address TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_city_state_zip TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_course_start TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_course_end TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_total_hours TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_no_of_cards_issued TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_student_manikin_ratio TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_issue_date_of_cards TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_card_expiration_date TEXT;
ALTER TABLE training_sessions ADD COLUMN hs_roster_pdf_path TEXT;

-- The trainer's own AHA Instructor ID# (Keeley's call: separate from the phone number now used
-- to identify trainers generally, since not every trainer teaches Heartsaver) - set once on
-- their profile, reused on every Heartsaver roster they close out.
ALTER TABLE employees ADD COLUMN aha_instructor_id TEXT;
