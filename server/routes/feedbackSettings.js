// Editable question text for the post-training feedback form (Keeley's request) - one fixed
// row of labels shared by every session's feedback form, not per-session settings. The public
// feedback page itself reads these through publicSessions.js's own session-context route
// (kept unauthenticated there), not through this route - this one is for the admin editor only.
const express = require('express');
const { dbGet, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const row = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  res.json(row);
});

router.put('/', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  const merged = { ...existing, ...req.body };
  const fields = [
    'could_ask_questions_label',
    'understood_material_label',
    'needs_additional_training_label',
    'effectiveness_label',
    'trainer_rating_label',
    'comment_label',
  ];
  for (const f of fields) {
    if (!merged[f] || !String(merged[f]).trim()) {
      return res.status(400).json({ error: `${f} cannot be blank` });
    }
  }
  await dbRun(
    `UPDATE feedback_form_settings
     SET could_ask_questions_label=?, understood_material_label=?, needs_additional_training_label=?,
         effectiveness_label=?, trainer_rating_label=?, comment_label=?
     WHERE id = 'default'`,
    [
      merged.could_ask_questions_label.trim(),
      merged.understood_material_label.trim(),
      merged.needs_additional_training_label.trim(),
      merged.effectiveness_label.trim(),
      merged.trainer_rating_label.trim(),
      merged.comment_label.trim(),
    ]
  );
  res.json(await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']));
});

module.exports = router;
