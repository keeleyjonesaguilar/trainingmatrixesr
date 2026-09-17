// Training Aliases - cleared 2026-09-17 alongside the master catalog rebuild (Keeley's request).
// Deliberately left empty rather than guessing variant spellings: several of the new catalog's
// trainings are near-duplicates that only differ by a qualifier the import's fuzzy-matching
// can't safely collapse on its own (e.g. "OSHA 10 (Construction)" vs "OSHA 10 (General
// Industry)", or the seven PIT Operator classes) - a wrong guess here would silently misfile
// real completions under the wrong training. Aliases an admin resolves manually through the
// Import Data review screen still get added to this same table at runtime as usual; this just
// starts that table empty instead of pre-loaded with anything unverified.

const TRAINING_ALIASES = [];

module.exports = TRAINING_ALIASES;
