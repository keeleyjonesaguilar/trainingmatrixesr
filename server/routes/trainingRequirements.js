const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const repo = require('../lib/repo');
const { EXPIRATION_UNITS } = require('../lib/statusEngine');

const router = express.Router();

// Client Settings screen (spec section 19): every Master Training for this client, showing
// whichever is in effect - Master Default or Client Override - clearly labeled.
router.get('/client/:clientId', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const masterTrainings = repo.listMasterTrainings();
  const requirements = repo.listRequirementsForClient(req.params.clientId);
  const byTrainingId = Object.fromEntries(requirements.map((r) => [r.training_id, r]));

  const rows = masterTrainings.map((mt) => {
    const req_ = byTrainingId[mt.training_id];
    return {
      training_id: mt.training_id,
      master_training_name: mt.training_name,
      category: mt.category,
      master_default_expiration: mt.default_expiration,
      requirement_status: req_ ? req_.requirement_status : 'Required',
      client_expiration_unit: req_ ? req_.client_expiration_unit : null,
      client_training_name: req_ ? req_.client_training_name : null,
      client_notes: req_ ? req_.client_notes : null,
      expiration_source: req_ && req_.client_expiration_unit ? 'Client Override' : 'Master Default',
      effective_expiration: req_ && req_.client_expiration_unit ? req_.client_expiration_unit : mt.default_expiration,
    };
  });
  res.json(rows);
});

// Upsert a client's override for one training. Overrides apply only to this client - the
// Master Trainings table and other clients' requirements are never touched (spec section 19).
router.put('/client/:clientId/training/:trainingId', (req, res) => {
  const { clientId, trainingId } = req.params;
  const client = db.prepare('SELECT client_id FROM clients WHERE client_id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const mt = db.prepare('SELECT * FROM master_trainings WHERE training_id = ?').get(trainingId);
  if (!mt) return res.status(404).json({ error: 'Training not found' });

  const { requirement_status = 'Required', client_expiration_unit = null, client_training_name = null, client_notes = null } = req.body;

  if (!['Required', 'Not Required', 'Optional', 'Not Applicable'].includes(requirement_status)) {
    return res.status(400).json({ error: 'Invalid requirement_status' });
  }
  if (client_expiration_unit !== null && !EXPIRATION_UNITS.includes(client_expiration_unit)) {
    return res.status(400).json({ error: `client_expiration_unit must be one of: ${EXPIRATION_UNITS.join(', ')} or null` });
  }

  const existing = repo.getRequirement(clientId, trainingId);
  if (existing) {
    db.prepare(
      `UPDATE client_training_requirements
       SET requirement_status=?, client_expiration_unit=?, client_training_name=?, client_notes=?
       WHERE requirement_id=?`
    ).run(requirement_status, client_expiration_unit, client_training_name, client_notes, existing.requirement_id);
  } else {
    db.prepare(
      `INSERT INTO client_training_requirements
       (requirement_id, client_id, training_id, requirement_status, client_expiration_unit, client_training_name, client_notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(uuidv4(), clientId, trainingId, requirement_status, client_expiration_unit, client_training_name, client_notes);
  }

  // Requirement changed - refresh every affected employee's computed status so the matrix
  // never shows stale data (design principle: recompute, don't hand-maintain).
  repo.recomputeAllForClientTraining(clientId, trainingId);

  res.json(repo.getRequirement(clientId, trainingId));
});

module.exports = router;
