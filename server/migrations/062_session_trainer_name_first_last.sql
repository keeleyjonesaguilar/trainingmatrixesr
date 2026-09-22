-- Sessions created by picking a trainer from the list stored the trainer's list-style name
-- ("Hilton, Kasey") as trainer_name, which prints on certificates and pre-fills the sign-off
-- form. Sessions.jsx now stores "First Last" (Keeley's request, 2026-09-22); this flips the
-- existing still-open ones the same way. Closed sessions are left as they were - their
-- certificates are already generated and use the name the trainer signed off with.
UPDATE training_sessions
SET trainer_name = trim(substring(trainer_name from position(',' in trainer_name) + 1)) || ' ' || trim(split_part(trainer_name, ',', 1))
WHERE status = 'open' AND trainer_name LIKE '%,%' AND trainer_name NOT LIKE '%,%,%';
