-- Lets an admin dismiss a specific possible-duplicate grouping (Keeley's request) without
-- merging it - e.g. two employees who really do share a name/phone but aren't the same
-- person. Keyed by the exact sorted set of member ids in that grouping, so if a new record
-- later joins the same name/phone, that's a distinct (unignored) grouping again.
CREATE TABLE IF NOT EXISTS duplicate_ignores (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('employee','client','trainer')),
  member_ids    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(entity_type, member_ids)
);
