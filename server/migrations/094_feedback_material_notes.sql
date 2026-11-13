-- Feedback form: the "Do you feel you need additional training on this topic?" Yes/No question is
-- gone (2026-11-13 - a "Yes" made a record that read as "inadequate training"). In its place the
-- training section gets an optional notes box, like the trainer section's comment box, where a
-- trainee can ask for more training (or note anything else about the material) in their own words.
--   material_notes           what they wrote (saved in English - Spanish is translated, like comments)
--   material_notes_original  their own words when it was translated
-- The old needs_additional_training / contact_name columns stay so earlier answers aren't lost.
ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS material_notes TEXT;
ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS material_notes_original TEXT;

-- The box's question, editable with the other feedback questions.
ALTER TABLE feedback_form_settings ADD COLUMN IF NOT EXISTS material_notes_label TEXT;
ALTER TABLE feedback_form_settings ADD COLUMN IF NOT EXISTS material_notes_label_es TEXT;
UPDATE feedback_form_settings
   SET material_notes_label = 'Any notes on the training material? (optional - e.g., questions about the material or a request for additional training)'
 WHERE material_notes_label IS NULL;
UPDATE feedback_form_settings
   SET material_notes_label_es = '¿Algún comentario sobre el material de capacitación? (opcional - por ejemplo, preguntas sobre el material o una solicitud de capacitación adicional)'
 WHERE material_notes_label_es IS NULL;
