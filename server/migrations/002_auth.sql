-- Login accounts + small key/value settings store, replacing the single shared-password
-- HTTP Basic Auth gate with real per-user accounts managed from an in-app admin screen.

CREATE TABLE IF NOT EXISTS app_users (
  user_id       TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Used to persist the random secret that signs session cookies, so sessions survive
-- server restarts/redeploys instead of forcing everyone to log in again each time.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
