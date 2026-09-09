-- Security hardening pass (Keeley's request, 2026-09-09): every login attempt - success or
-- failure - is recorded here with IP/user-agent, both to power account lockout (below) and as
-- the data source for a future Super Admin audit view (who's logging in, from where, failed
-- attempts). Nothing about this table gates normal use - it's write-then-read-only from the
-- app's perspective.
CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_id         TEXT PRIMARY KEY,
  username_attempted TEXT NOT NULL,
  ip_address         TEXT,
  user_agent         TEXT,
  success            INTEGER NOT NULL,
  blocked            INTEGER NOT NULL DEFAULT 0,
  attempted_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts(username_attempted, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
