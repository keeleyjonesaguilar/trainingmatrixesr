-- General-purpose activity log (Keeley's request, 2026-09-17) - distinct from admin_actions
-- (037_admin_actions.sql, which is schema-locked to app_users targets for account-security
-- events). This describes arbitrary entities via entity_type/entity_id instead, so it can
-- represent "created a training session" or "downloaded a certificate" just as well as any
-- future entity type, without needing its own migration each time.
CREATE TABLE IF NOT EXISTS activity_log (
  activity_id    TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES app_users(user_id) ON DELETE SET NULL,
  actor_username TEXT NOT NULL,
  action         TEXT NOT NULL,
  entity_type    TEXT,
  entity_id      TEXT,
  entity_label   TEXT,
  details        TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor_username ON activity_log (actor_username);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log (entity_type, entity_id);
