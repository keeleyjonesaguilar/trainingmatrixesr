// Editable question text for the post-training feedback form (Keeley's request) - one fixed
// row of labels shared by every session's feedback form, not per-session settings. The public
// feedback page itself reads these through publicSessions.js's own session-context route
// (kept unauthenticated there), not through this route - this one is for the admin editor only.
const express = require('express');
const { dbGet, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { translateToSpanish } = require('../lib/translate');
const { logActivity } = require('../lib/activityLog');

const router = express.Router();

const FIELDS = [
  'could_ask_questions_label',
  'understood_material_label',
  'needs_additional_training_label',
  'effectiveness_label',
  'trainer_rating_label',
  'comment_label',
];

router.get('/', async (req, res) => {
  const row = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  res.json(row);
});

router.put('/', requireAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  const merged = { ...existing, ...req.body };
  for (const f of FIELDS) {
    if (!merged[f] || !String(merged[f]).trim()) {
      return res.status(400).json({ error: `${f} cannot be blank` });
    }
  }

  // Spanish text is auto-translated here, at save time, the same way a session's own training
  // name/outline is (see trainingSessions.js's translateSessionFields) - so the public feedback
  // page (any session marked spanish/both) never calls the translation API itself, and a session
  // in Spanish always has something to show regardless of which session it is. Best-effort: a
  // failed/unconfigured translation still saves the English text rather than blocking the save.
  let warning = null;
  const translated = {};
  try {
    const results = await Promise.all(FIELDS.map((f) => translateToSpanish(merged[f].trim())));
    FIELDS.forEach((f, i) => { translated[f] = results[i] || existing[`${f}_es`] || null; });
  } catch (err) {
    warning = err.message;
    FIELDS.forEach((f) => { translated[f] = existing[`${f}_es`] || null; });
  }

  await dbRun(
    `UPDATE feedback_form_settings
     SET could_ask_questions_label=?, understood_material_label=?, needs_additional_training_label=?,
         effectiveness_label=?, trainer_rating_label=?, comment_label=?,
         could_ask_questions_label_es=?, understood_material_label_es=?, needs_additional_training_label_es=?,
         effectiveness_label_es=?, trainer_rating_label_es=?, comment_label_es=?
     WHERE id = 'default'`,
    [
      merged.could_ask_questions_label.trim(),
      merged.understood_material_label.trim(),
      merged.needs_additional_training_label.trim(),
      merged.effectiveness_label.trim(),
      merged.trainer_rating_label.trim(),
      merged.comment_label.trim(),
      translated.could_ask_questions_label,
      translated.understood_material_label,
      translated.needs_additional_training_label,
      translated.effectiveness_label,
      translated.trainer_rating_label,
      translated.comment_label,
    ]
  );
  const updated = await dbGet('SELECT * FROM feedback_form_settings WHERE id = ?', ['default']);
  logActivity({ actor: req.user, action: 'feedback_settings_updated', entityType: 'settings', entityId: 'feedback_form', req });
  res.json(warning ? { ...updated, warning } : updated);
});

module.exports = router;
