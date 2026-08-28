// One-time data fixes - each runs exactly once (guarded by an app_settings flag), never on
// every boot, so they can't silently undo later admin edits or wipe data a second time.
const { dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { getSetting, setSetting } = require('./settings');

async function runOnce(flagKey, description, fn) {
  if (await getSetting(flagKey)) return;
  await fn();
  await setSetting(flagKey, new Date().toISOString());
  console.log(`One-time fix applied: ${description}`);
}

async function runOneTimeFixes() {
  // Keeley's request: no more automatic per-training expiration rules - every Master
  // Training's default resets to None once. She can still set a default per training
  // (or a client-specific override) any time afterward from the app; this never runs again.
  await runOnce('fix_reset_default_expirations_v1', 'reset all Master Training default expirations to None', async () => {
    await dbRun(`UPDATE master_trainings SET default_expiration = 'None'`);
  });

  // Keeley's request: clear out all existing clients/employees before this update goes live,
  // for a clean start. Deleting from clients cascades (ON DELETE CASCADE) to employees,
  // employee_training_records, client_training_requirements, and import_batches (and its
  // staged rows/column maps) - the Master Training Catalog, training aliases, and login
  // accounts are untouched. This runs exactly once and never again, even on later restarts.
  await runOnce('fix_wipe_clients_and_employees_v1', 'cleared all existing clients/employees for a fresh start', async () => {
    await dbRun('DELETE FROM clients');
  });

  // Trainers feature: existing training_sessions.trainer_name values predate
  // trainer_employee_id. Backfill a Trainer profile for each distinct name on file so
  // "Trainings Taught" is populated for historical sessions too, not just new ones.
  await runOnce('fix_backfill_trainer_employees_v1', 'linked existing training_sessions.trainer_name values to Trainer employee records', async () => {
    const rows = await dbAll(`SELECT DISTINCT trainer_name FROM training_sessions WHERE trainer_employee_id IS NULL`);
    for (const { trainer_name } of rows) {
      const trainerEmployeeId = await repo.findOrCreateTrainerEmployee(trainer_name);
      if (trainerEmployeeId) {
        await dbRun(`UPDATE training_sessions SET trainer_employee_id = ? WHERE trainer_name = ? AND trainer_employee_id IS NULL`, [
          trainerEmployeeId,
          trainer_name,
        ]);
      }
    }
  });
}

module.exports = { runOneTimeFixes };
