-- Emailing certificates by hand from a closed session (Keeley's request, 2026-10-14: sending them
-- out one at a time was "taking a lot of time out of my day"). Two buttons on the session page:
-- each attendee gets their own certificate(s), and the company gets the certificate ZIP(s). Nothing
-- is sent automatically.

-- Where a company's certificates go - one or more addresses, comma-separated. Filled in on the
-- client's page, or saved from the send window the first time.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS certificate_emails TEXT;

-- When an attendee's certificate was last emailed, and to which address.
ALTER TABLE session_attendees ADD COLUMN IF NOT EXISTS certificate_emailed_at TEXT;
ALTER TABLE session_attendees ADD COLUMN IF NOT EXISTS certificate_emailed_to TEXT;

-- When the company was last sent the certificates, and to which addresses.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS certificates_emailed_to_client_at TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS certificates_emailed_to_client TEXT;
