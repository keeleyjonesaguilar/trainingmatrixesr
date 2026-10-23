-- Public sign-up is an interest list only for now (Keeley, 2026-10-23: "just going to be gathering
-- information for people interested to keep it simple") - no price, payment link, seat limit or
-- Paid tick. 088 had already run, so its unused columns are dropped here.
ALTER TABLE training_sessions DROP COLUMN IF EXISTS public_price_cents;
ALTER TABLE training_sessions DROP COLUMN IF EXISTS public_payment_url;
ALTER TABLE training_sessions DROP COLUMN IF EXISTS public_seat_limit;
ALTER TABLE public_registrations DROP COLUMN IF EXISTS price_cents;
ALTER TABLE public_registrations DROP COLUMN IF EXISTS paid;
ALTER TABLE public_registrations DROP COLUMN IF EXISTS paid_at;
