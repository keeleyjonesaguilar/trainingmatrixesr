// One-time data fixes - each runs exactly once (guarded by an app_settings flag), never on
// every boot, so they can't silently undo later admin edits or wipe data a second time.
const db = require('../db');
const { getSetting, setSetting } = require('./settings');

function runOnce(flagKey, description, fn) {
  if (getSetting(flagKey)) return;
  fn();
  setSetting(flagKey, new Date().toISOString());
  console.log(`One-time fix applied: ${description}`);
}

function runOneTimeFixes() {
  // Keeley's request: no more automatic per-training expiration rules - every Master
  // Training's default resets to None once. She can still set a default per training
  // (or a client-specific override) any time afterward from the app; this never runs again.
  runOnce('fix_reset_default_expirations_v1', 'reset all Master Training default expirations to None', () => {
    db.prepare(`UPDATE master_trainings SET default_expiration = 'None'`).run();
  });

  // Keeley's request: clear out all existing clients/employees before this update goes live,
  // for a clean start. Deleting from clients cascades (ON DELETE CASCADE) to employees,
  // employee_training_records, client_training_requirements, and import_batches (and its
  // staged rows/column maps) - the Master Training Catalog, training aliases, and login
  // accounts are untouched. This runs exactly once and never again, even on later restarts.
  runOnce('fix_wipe_clients_and_employees_v1', 'cleared all existing clients/employees for a fresh start', () => {
    db.prepare('DELETE FROM clients').run();
  });
}

module.exports = { runOneTimeFixes };
