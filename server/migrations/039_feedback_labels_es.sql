ALTER TABLE feedback_form_settings
  ADD COLUMN IF NOT EXISTS could_ask_questions_label_es       TEXT,
  ADD COLUMN IF NOT EXISTS understood_material_label_es       TEXT,
  ADD COLUMN IF NOT EXISTS needs_additional_training_label_es TEXT,
  ADD COLUMN IF NOT EXISTS effectiveness_label_es             TEXT,
  ADD COLUMN IF NOT EXISTS trainer_rating_label_es            TEXT,
  ADD COLUMN IF NOT EXISTS comment_label_es                   TEXT;
