-- Adds TOTP-based multi-factor authentication support (security hardening pass, 2026-09-10).
-- mfa_secret: base32 TOTP secret, set once MFA is enabled for the account (NULL until then).
-- mfa_enabled: whether login requires a second factor for this account.
-- mfa_backup_codes: one-time recovery codes (hashed the same way as password_hash), consumed one
--   at a time if the account holder loses access to their authenticator app.
ALTER TABLE app_users ADD COLUMN mfa_secret TEXT;
ALTER TABLE app_users ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN mfa_backup_codes TEXT[] NOT NULL DEFAULT '{}';
