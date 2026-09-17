-- Lets a new-user invite link (server/lib/passwordReset.js) be distinguished from a plain
-- "forgot password" reset link at consumption time (server/routes/auth.js POST /reset-password) -
-- an invite lets the person choose their own username alongside their password; a reset only
-- ever touches the password. Existing rows default to 'reset' since that's all that existed
-- before invites did.
ALTER TABLE password_reset_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'reset';
