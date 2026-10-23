-- Public sign-up for open-enrollment classes (Keeley's request, 2026-10-23: an English OSHA 30 at
-- the ESR office that anyone can sign up for and pay for). The class is a normal training session;
-- the office opens it to the public and the sign-up page lives at /register/<public_signup_token>.
-- People who sign up still sign in each day with the session's usual QR code.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_signup_token TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_signup_open INTEGER NOT NULL DEFAULT 0;
-- Price per seat in cents (blank = no price shown), the payment page sign-ups are sent to, an
-- optional cap on total seats, the class hours shown on the page ("7:30 AM – 4:30 PM"), and any
-- extra notes ("OSHA cards will be provided upon completion").
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_price_cents INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_payment_url TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_seat_limit INTEGER;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_class_hours TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS public_details TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_sessions_public_signup_token ON training_sessions(public_signup_token);

-- One row per sign-up: the person filling in the form, and how many seats they're buying.
CREATE TABLE IF NOT EXISTS public_registrations (
  registration_id      TEXT PRIMARY KEY,
  session_id           TEXT NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  contact_first_name   TEXT NOT NULL,
  contact_last_name    TEXT NOT NULL,
  contact_email        TEXT NOT NULL,
  contact_phone        TEXT NOT NULL,
  company              TEXT,
  seats                INTEGER NOT NULL,
  price_cents          INTEGER,
  paid                 INTEGER NOT NULL DEFAULT 0,
  paid_at              TEXT,
  created_at           TEXT NOT NULL DEFAULT now_utc_text()
);
CREATE INDEX IF NOT EXISTS idx_public_registrations_session ON public_registrations(session_id);

-- Each seat's attendee name (Keeley, 2026-10-23: "multiple seats require multiple names").
CREATE TABLE IF NOT EXISTS public_registration_attendees (
  id                TEXT PRIMARY KEY,
  registration_id   TEXT NOT NULL REFERENCES public_registrations(registration_id) ON DELETE CASCADE,
  seat_number       INTEGER NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_registration_attendees_reg ON public_registration_attendees(registration_id);
