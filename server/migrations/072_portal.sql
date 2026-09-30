-- Employee/trainer portal at /portal (Keeley's request, 2026-09-30): invited employees and
-- trainers sign in with their email and a one-time code, see their own trainings, update their
-- phone/email; trainers also see what they teach and their rating averages. Separate from the
-- office login (app_users) - see server/lib/portal.js.

-- Only invited profiles can sign in (Keeley's call); clearing this revokes access.
ALTER TABLE employees ADD COLUMN portal_invited_at TEXT;
ALTER TABLE employees ADD COLUMN portal_last_login_at TEXT;

-- One-time sign-in codes, stored hashed; short-lived and limited attempts.
CREATE TABLE IF NOT EXISTS portal_login_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT now_utc_text()
);
CREATE INDEX IF NOT EXISTS idx_portal_codes_email ON portal_login_codes(email);

-- Signed-in portal sessions (the cookie holds a random token; only its hash is stored).
CREATE TABLE IF NOT EXISTS portal_sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT now_utc_text(),
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_email ON portal_sessions(email);

-- A new email address waiting to be confirmed with a code sent to it.
CREATE TABLE IF NOT EXISTS portal_email_changes (
  id          TEXT PRIMARY KEY,
  old_email   TEXT NOT NULL,
  new_email   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT now_utc_text()
);
