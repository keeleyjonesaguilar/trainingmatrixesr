// One-time data fixes - each runs exactly once (guarded by an app_settings flag), never on
// every boot, so they can't silently undo later admin edits or wipe data a second time.
const fs = require('fs');
const path = require('path');
const { dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { getSetting, setSetting } = require('./settings');
const { DATA_DIR } = require('./paths');

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

  // Security hardening pass (Keeley's request, 2026-09-09): introduces a super_admin role
  // (account/security administration - granting super_admin itself, and the new login audit
  // log) sitting above the existing admin/user roles. Bootstraps it onto whichever admin
  // account(s) exist right now, since from here on granting super_admin requires already
  // being one - there'd otherwise be no way for anyone to ever become the first.
  await runOnce('fix_bootstrap_super_admin_v1', 'promoted existing admin account(s) to super_admin', async () => {
    await dbRun("UPDATE app_users SET role = 'super_admin' WHERE role = 'admin'");
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

  // Removes the one leftover roster PDF + certificate folder from the 2026-09-17 stress test
  // (75 sign-ins against a disposable client) - its database rows are already gone (the client
  // delete that used to 500 on this exact scenario is what the stress test found and fixed),
  // but the files themselves live on this server's own disk, which a local dev machine can't
  // reach directly - this runs once, on this server, to actually remove them.
  await runOnce('fix_cleanup_2026_09_17_stress_test_files_v1', 'removed orphaned stress-test roster/certificate files', async () => {
    const rosterPath = path.join(DATA_DIR, 'rosters', 'de91f731-1ac7-444b-b850-52b65431feeb.pdf');
    const certDir = path.join(DATA_DIR, 'certificates', 'sign-in-sessions', 'de91f731-1ac7-444b-b850-52b65431feeb');
    if (fs.existsSync(rosterPath)) fs.unlinkSync(rosterPath);
    if (fs.existsSync(certDir)) fs.rmSync(certDir, { recursive: true, force: true });
  });
}

module.exports = { runOneTimeFixes };
