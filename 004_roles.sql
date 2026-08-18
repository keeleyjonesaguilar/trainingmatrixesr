-- Admin/User roles (Keeley's request): admin can edit everything (clients, employees,
-- master trainings, client settings, import, training records, user management). A plain
-- "user" is read-only everywhere. Defaults every EXISTING account to 'admin' so nobody who
-- could already edit things gets locked out when this ships.
ALTER TABLE app_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','user'));
