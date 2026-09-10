-- Privileged-action audit trail (security hardening pass, 2026-09-10). login_attempts (033)
-- only covers logging in - this covers what an already-authenticated session then DOES: create/
-- delete a user, change a role, reset someone's password, disable MFA, change an email. Without
-- this, a compromised admin session could do all of the above with zero trace in the app. Every
-- row here is written by server/lib/adminAudit.js, never edited or deleted by the app itself.
CREATE TABLE admin_actions (
  action_id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_username TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_actions_created_at ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_target_user_id ON admin_actions (target_user_id);
CREATE INDEX idx_admin_actions_actor_user_id ON admin_actions (actor_user_id);
