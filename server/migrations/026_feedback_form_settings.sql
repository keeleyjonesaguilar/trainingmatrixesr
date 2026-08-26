CREATE TABLE IF NOT EXISTS feedback_form_settings (
  id                                TEXT PRIMARY KEY DEFAULT 'default',
  could_ask_questions_label         TEXT NOT NULL,
  understood_material_label         TEXT NOT NULL,
  needs_additional_training_label   TEXT NOT NULL,
  effectiveness_label               TEXT NOT NULL,
  trainer_rating_label              TEXT NOT NULL,
  comment_label                     TEXT NOT NULL
);

INSERT OR IGNORE INTO feedback_form_settings
  (id, could_ask_questions_label, understood_material_label, needs_additional_training_label, effectiveness_label, trainer_rating_label, comment_label)
VALUES
  ('default',
   'Were you able to ask questions during the training?',
   'Did you understand the material?',
   'Do you feel you need additional training on this topic?',
   'How effective was the training overall?',
   'How would you rate the trainer?',
   'Any comments on the trainer''s performance? (optional)');
