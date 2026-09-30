-- Import now reads employee email and the trainer's phone/email too (Keeley's request,
-- 2026-09-30: "import needs to read employee phone #, email, trainer information also"). Staged
-- raw like every other imported column; applied at commit (server/routes/import.js).
ALTER TABLE import_staged_rows ADD COLUMN email_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN trainer_phone_raw TEXT;
ALTER TABLE import_staged_rows ADD COLUMN trainer_email_raw TEXT;
