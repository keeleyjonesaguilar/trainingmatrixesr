const { dbGet, dbRun, withTransaction } = require('../db');
const { v4: uuidv4 } = require('uuid');
const MASTER_TRAININGS = require('./masterTrainings');
const TRAINING_ALIASES = require('./aliases');

function normalize(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function runSeed() {
  await withTransaction(async () => {
    for (const t of MASTER_TRAININGS) {
      await dbRun(
        `INSERT INTO master_trainings (training_id, training_name, category, training_type, default_expiration, active, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(training_id) DO UPDATE SET
           training_name=excluded.training_name,
           category=excluded.category,
           training_type=excluded.training_type,
           default_expiration=excluded.default_expiration,
           active=excluded.active,
           display_order=excluded.display_order`,
        [t.training_id, t.training_name, t.category, t.training_type, t.default_expiration, t.active, t.display_order]
      );
    }
    for (const [aliasText, trainingId] of TRAINING_ALIASES) {
      await dbRun(
        `INSERT INTO training_aliases (alias_id, alias_text, training_id)
         VALUES (?, ?, ?)
         ON CONFLICT(alias_text) DO UPDATE SET training_id=excluded.training_id`,
        [uuidv4(), normalize(aliasText), trainingId]
      );
    }
  });

  console.log(`Seeded ${MASTER_TRAININGS.length} master trainings and ${TRAINING_ALIASES.length} aliases.`);
}

// Safe to call on every server boot: only actually seeds when the catalog is empty, so it
// never overwrites trainings someone has since edited/added in the running app. This means a
// fresh deploy (e.g. on Railway) is populated automatically - no manual shell step required.
async function seedIfEmpty() {
  const { n: count } = await dbGet('SELECT COUNT(*) AS n FROM master_trainings');
  if (Number(count) === 0) {
    await runSeed();
  } else {
    console.log(`Master Training Catalog already has ${count} entries - skipping auto-seed.`);
  }
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runSeed, seedIfEmpty };
