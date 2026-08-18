const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const MASTER_TRAININGS = require('./masterTrainings');
const TRAINING_ALIASES = require('./aliases');

function normalize(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function runSeed() {
  const insertTraining = db.prepare(`
    INSERT INTO master_trainings (training_id, training_name, category, training_type, default_expiration, active, display_order)
    VALUES (@training_id, @training_name, @category, @training_type, @default_expiration, @active, @display_order)
    ON CONFLICT(training_id) DO UPDATE SET
      training_name=excluded.training_name,
      category=excluded.category,
      training_type=excluded.training_type,
      default_expiration=excluded.default_expiration,
      active=excluded.active,
      display_order=excluded.display_order
  `);

  const insertAlias = db.prepare(`
    INSERT INTO training_aliases (alias_id, alias_text, training_id)
    VALUES (?, ?, ?)
    ON CONFLICT(alias_text) DO UPDATE SET training_id=excluded.training_id
  `);

  const txn = db.transaction(() => {
    for (const t of MASTER_TRAININGS) insertTraining.run(t);
    for (const [aliasText, trainingId] of TRAINING_ALIASES) {
      insertAlias.run(uuidv4(), normalize(aliasText), trainingId);
    }
  });

  txn();

  console.log(`Seeded ${MASTER_TRAININGS.length} master trainings and ${TRAINING_ALIASES.length} aliases.`);
}

// Safe to call on every server boot: only actually seeds when the catalog is empty, so it
// never overwrites trainings someone has since edited/added in the running app. This means a
// fresh deploy (e.g. on Railway) is populated automatically - no manual shell step required.
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM master_trainings').get().n;
  if (count === 0) {
    runSeed();
  } else {
    console.log(`Master Training Catalog already has ${count} entries - skipping auto-seed.`);
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed, seedIfEmpty };
