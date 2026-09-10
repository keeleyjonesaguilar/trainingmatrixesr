// Single source of truth for which tables a backup/restore touches and in what order, shared by
// server/lib/backupScheduler.js (automated, in-process) and server/scripts/backup-db.js /
// restore-db.js (manual, run from outside Render). Keep in sync with server/migrations/*.sql if a
// new table is ever added.
//
// Order doesn't matter for a plain data dump (no FK enforcement happens on SELECT), but restore
// inserts in exactly this order - parents before the children that reference them - and deletes
// in reverse, so foreign key constraints are never violated either direction.
const TABLES_IN_DEPENDENCY_ORDER = [
  'app_settings',
  'app_users',
  'master_trainings',
  'clients',
  'employees',
  'client_training_requirements',
  'training_aliases',
  'import_batches',
  'import_column_map',
  'import_staged_rows',
  'employee_training_records',
  'training_sessions',
  'session_attendees',
  'duplicate_ignores',
  'ignored_compliance_gaps',
  'session_feedback',
  'feedback_form_settings',
  'login_attempts',
  'schema_migrations',
];

module.exports = { TABLES_IN_DEPENDENCY_ORDER };
