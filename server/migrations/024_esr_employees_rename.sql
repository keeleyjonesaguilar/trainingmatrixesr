-- Renames the internal trainers pseudo-client's display name (Keeley's request, following her
-- president's review) - purely cosmetic, every filter elsewhere already keys off is_internal/
-- INTERNAL_CLIENT_ID, never this name, so trainers stay excluded from all compliance totals
-- exactly as before.
UPDATE clients SET client_name = 'ESR Employees' WHERE client_id = 'internal-trainers';
