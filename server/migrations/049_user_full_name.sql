-- A username is a login handle, not a name - Keeley's request, 2026-09-17: show a real name in
-- the top bar once logged in, and in the invite email so the recipient can confirm it's actually
-- meant for them. Nullable (existing accounts have none until she fills them in) - the "Add a
-- user" form makes it required going forward, so every future invite has one.
ALTER TABLE app_users ADD COLUMN full_name TEXT;
