const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbRun } = require('../db');
const repo = require('../lib/repo');
const { EXPIRATION_UNITS } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Client Settings screen (spec section 19): every Master Training for this client, showing
// whichever is in effect - Master Default or Client Override - clearly labeled.
router.get('/client/:clientId', async (req, res) => {
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const masterTrainings = await repo.listMasterTrainings();
  const requirements = await repo.listRequirementsForClient(req.params.clientId);
  const byTrainingId = Object.fromEntries(requirements.map((r) => [r.training_id, r]));

  const rows = masterTrainings.map((mt) => {
    const req_ = byTrainingId[mt.training_id];
    return {
      training_id: mt.training_id,
      master_training_name: mt.training_name,
      category: mt.category,
      master_default_expiration: mt.default_expiration,
      // No override row yet -> Not Required by default (Keeley's call, 2026-08-18): a client
      // starts with nothing required until an admin explicitly flips a training to Required.
      requirement_status: req_ ? req_.requirement_status : 'Not Required',
      client_expiration_unit: req_ ? req_.client_expiration_unit : null,
      client_training_name: req_ ? req_.client_training_name : null,
      client_notes: req_ ? req_.client_notes : null,
      effective_date: req_ ? req_.effective_date : null,
      expiration_source: req_ && req_.client_expiration_unit ? 'Client Override' : 'Master Default',
      effective_expiration: req_ && req_.client_expiration_unit ? req_.client_expiration_unit : mt.default_expiration,
    };
  });
  res.json(rows);
});

// Upsert a client's override for one training. Overrides apply only to this client - the
// Master Trainings table and other clients' requirements are never touched (spec section 19).
router.put('/client/:clientId/training/:trainingId', requireAdmin, async (req, res) => {
  const { clientId, trainingId } = req.params;
  const client = await dbGet('SELECT client_id FROM clients WHERE client_id = ?', [clientId]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const mt = await dbGet('SELECT * FROM master_trainings WHERE training_id = ?', [trainingId]);
  if (!mt) return res.status(404).json({ error: 'Training not found' });

  const { requirement_status = 'Not Required', client_expiration_unit = null, client_training_name = null, client_notes = null, effective_date } = req.body;

  if (!['Required', 'Not Required', 'Optional', 'Not Applicable'].includes(requirement_status)) {
    return res.status(400).json({ error: 'Invalid requirement_status' });
  }
  if (client_expiration_unit !== null && !EXPIRATION_UNITS.includes(client_expiration_unit)) {
    return res.status(400).json({ error: `client_expiration_unit must be one of: ${EXPIRATION_UNITS.join(', ')} or null` });
  }

  // Rule 9: a requirement/override change must not silently rewrite historical records.
  // Default the effective date to today (unless the caller explicitly supplies one, e.g.
  // backdating for a correction) so recompute only reaches forward from this point on.
  const resolvedEffectiveDate = effective_date === undefined ? new Date().toISOString().slice(0, 10) : (effective_date || null);

  const existing = await repo.getRequirement(clientId, trainingId);
  if (existing) {
    await dbRun(
      `UPDATE client_training_requirements
       SET requirement_status=?, client_expiration_unit=?, client_training_name=?, client_notes=?, effective_date=?
       WHERE requirement_id=?`,
      [requirement_status, client_expiration_unit, client_training_name, client_notes, resolvedEffectiveDate, existing.requirement_id]
    );
  } else {
    await dbRun(
      `INSERT INTO client_training_requirements
       (requirement_id, client_id, training_id, requirement_status, client_expiration_unit, client_training_name, client_notes, effective_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [uuidv4(), clientId, trainingId, requirement_status, client_expiration_unit, client_training_name, client_notes, resolvedEffectiveDate]
    );
  }

  // Requirement changed - refresh affected employees' computed status so the matrix never
  // shows stale data, but respect the effective date so records completed before the change
  // keep whatever they were already given (design principle: recompute, don't hand-maintain -
  // but never rewrite history either).
  await repo.recomputeAllForClientTraining(clientId, trainingId, resolvedEffectiveDate);

  res.json(await repo.getRequirement(clientId, trainingId));
});

module.exports = router;
