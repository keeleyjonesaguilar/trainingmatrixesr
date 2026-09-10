-- Forgot-password support (security hardening pass, 2026-09-10). Accounts previously had no
-- email address on file at all - one is required so there's somewhere to send a reset link.
-- Nullable (existing accounts start without one; a unique index still allows any number of NULLs
-- in Postgres, so that's compatible with accounts that never set one).
ALTER TABLE app_users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_app_users_email ON app_users (email) WHERE email IS NOT NULL;

-- Reset tokens are single-use and short-lived. Only the hash is stored (same principle as
-- password_hash) so a leaked database row can't be replayed as a live reset link. A dedicated
-- table (rather than columns on app_users) means requesting a new reset link doesn't require
-- clearing out a previous one - old rows just naturally lose the race (still checked for
-- expires_at/used_at, but harmless to have more than one outstanding).
-- app_users.user_id is TEXT (this app stores its own uuidv4() strings, not native Postgres UUID -
-- a leftover of its SQLite origins), so the foreign key column here has to match that type.
CREATE TABLE password_reset_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);
