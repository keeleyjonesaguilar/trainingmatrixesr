// Editable PIN a trainer enters to close out a Training Sign-In session (Keeley's request,
// 2026-09-16) - previously a fixed, hardcoded "ESR" (see publicSessions.js's close route,
// which still does the actual check against this table, not through this route - that route
// stays unauthenticated for the trainer's own device, so the PIN itself is never exposed there).
// One shared PIN for every session, same single-row-settings pattern as feedbackSettings.js.
const express = require('express');
const { dbGet, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  const row = await dbGet('SELECT * FROM trainer_close_pin_settings WHERE id = ?', ['default']);
  res.json(row);
});

router.put('/', requireAdmin, async (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'PIN cannot be blank' });
  await dbRun(`UPDATE trainer_close_pin_settings SET pin = ? WHERE id = 'default'`, [pin]);
  res.json(await dbGet('SELECT * FROM trainer_close_pin_settings WHERE id = ?', ['default']));
});

module.exports = router;
