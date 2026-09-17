-- In-app notification center (Keeley's request, 2026-09-17): a bell icon in the top bar with an
-- unread count, starting with "a training session was completed" - broadcast to every app_user
-- (not opt-in), plus an email via the same Resend integration already used for invites/resets.
-- One row per recipient (rather than one shared row with a separate read-tracking table) since
-- the volume here is low and this keeps "mark as read" a single-row update with no join.
CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT,
  link_path        TEXT,
  read_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT now_utc_text()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
