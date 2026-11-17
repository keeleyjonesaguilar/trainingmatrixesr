-- Class Needs (Keeley's list, 2026-11-16, item 11: "Add section on matrix to record what is needed
-- (ex. AV hookup, company contact email for roster distribution)"). A plain record on the session
-- page - no emails or approval step (the 10/07 session prep workflow was rolled back for that).
--   needs_av_hookup     'yes' / 'no' / NULL (not asked yet)
--   roster_emails       who at the company gets the roster - comma-separated; prefills
--                       "Email Certificates to Company" for this session
--   needs_notes         anything else the class needs (free text)
--   needs_updated_at/by when and who last saved this section
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_av_hookup TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS roster_emails TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_notes TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_updated_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS needs_updated_by TEXT;
