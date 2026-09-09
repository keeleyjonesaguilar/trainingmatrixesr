-- Adds the super_admin role (security hardening pass, 2026-09-09) to the existing
-- admin/user check constraint on app_users.role.
ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('user', 'admin', 'super_admin'));
