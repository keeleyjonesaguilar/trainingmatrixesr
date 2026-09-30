-- Who gets the completed-training (close-out) email with the certificates and rosters (Keeley's
-- request, 2026-09-30: "we don't have a way to edit that on the backend"). Until now it always
-- went to the trainer(s) plus every app user; these defaults keep exactly that behavior.
ALTER TABLE app_users ADD COLUMN gets_session_emails INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS email_settings (
  id                         TEXT PRIMARY KEY,
  session_emails_to_trainers INTEGER NOT NULL DEFAULT 1,
  -- Extra addresses (not app users) that also get every completed-training email, comma-separated.
  session_emails_extra       TEXT
);
INSERT INTO email_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
