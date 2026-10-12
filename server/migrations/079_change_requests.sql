-- Change requests (Keeley's request, 2026-10-12: requests for changes and updates were coming in
-- verbally, too many at once, with nowhere to keep them). Anyone signed in to the office side
-- submits one on the Requests page; the Super Admin gets a bell notification, sets the status and
-- can leave a note back, and the person who asked is notified when the status changes.
CREATE TABLE IF NOT EXISTS change_requests (
  request_id          TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  details             TEXT,
  category            TEXT NOT NULL DEFAULT 'change' CHECK (category IN ('change', 'new_feature', 'problem', 'other')),
  area                TEXT,
  priority            TEXT NOT NULL DEFAULT 'nice_to_have' CHECK (priority IN ('nice_to_have', 'important', 'urgent')),
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'in_progress', 'done', 'not_doing')),
  status_note         TEXT,
  submitted_by        TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
  submitted_by_name   TEXT NOT NULL,
  status_changed_by   TEXT,
  status_changed_at   TEXT,
  created_at          TEXT NOT NULL DEFAULT now_utc_text(),
  updated_at          TEXT NOT NULL DEFAULT now_utc_text()
);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_change_requests_submitted_by ON change_requests(submitted_by);
