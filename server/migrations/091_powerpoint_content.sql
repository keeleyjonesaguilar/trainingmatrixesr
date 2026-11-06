-- PowerPoints in the app (Keeley's "Training matrix features 11.6", 2026-11-06): WeTransfer goes
-- away. Every PowerPoint lives on the Content page (Setup menu), each training type points at its
-- deck, and a trainer downloads the decks for their class from the class summary email or the
-- Training Portal - with a Sign-In QR slide added at the start and a Feedback QR slide at the end
-- for that class, so nobody edits a deck per class.

-- One uploaded PowerPoint (.pptx). file_path is relative to DATA_DIR (so a file uploaded on one
-- computer never stores a C:\ path in the shared database); the previous upload is kept as a
-- single step back.
CREATE TABLE IF NOT EXISTS content_decks (
  deck_id                    TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  notes                      TEXT,
  file_path                  TEXT,
  original_filename          TEXT,
  file_size                  BIGINT,
  slide_width                BIGINT,
  slide_height               BIGINT,
  uploaded_at                TEXT,
  uploaded_by                TEXT,
  previous_file_path         TEXT,
  previous_original_filename TEXT,
  previous_file_size         BIGINT,
  previous_uploaded_at       TEXT,
  previous_uploaded_by       TEXT,
  created_at                 TEXT NOT NULL DEFAULT now_utc_text(),
  updated_at                 TEXT
);

-- Each slide of a deck's current upload, with what the office set on the Content page: its order,
-- hidden in the slideshow, a transition (NULL = keep what the PowerPoint has), a label, and a
-- "needs update" flag with a note. part_name is the slide's file inside the .pptx; title, text and
-- notes are read from it for the slide card. fingerprint (its text) carries labels and flags over
-- when a new version of the deck is uploaded.
CREATE TABLE IF NOT EXISTS content_deck_slides (
  id               TEXT PRIMARY KEY,
  deck_id          TEXT NOT NULL REFERENCES content_decks(deck_id) ON DELETE CASCADE,
  part_name        TEXT NOT NULL,
  position         INTEGER NOT NULL,
  hidden           INTEGER NOT NULL DEFAULT 0,
  transition       TEXT,
  file_transition  TEXT,
  label            TEXT,
  flagged          INTEGER NOT NULL DEFAULT 0,
  flag_note        TEXT,
  flagged_by       TEXT,
  flagged_at       TEXT,
  title            TEXT,
  body_text        TEXT,
  notes_text       TEXT,
  picture_part     TEXT,
  fingerprint      TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_deck_slides_deck ON content_deck_slides(deck_id, position);

-- A training type's PowerPoint, and - for a multi-day course like OSHA 30 - the training types
-- each day covers (JSON: one list of training_ids per day). Each topic's own deck is what that
-- day's trainer gets, so updating the Fall Protection deck updates it everywhere it's taught.
ALTER TABLE master_trainings ADD COLUMN IF NOT EXISTS deck_id TEXT REFERENCES content_decks(deck_id) ON DELETE SET NULL;
ALTER TABLE master_trainings ADD COLUMN IF NOT EXISTS default_day_topics TEXT;

-- The key in a class's PowerPoint download links (class summary email, Training Portal). Its own
-- random value, so the link can't be used to sign in or give feedback.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS files_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_sessions_files_token ON training_sessions(files_token);
