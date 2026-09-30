-- A client's own logo (Keeley's request, 2026-09-30: shown on their profile now, and ready for
-- client portals later). Stored in the database as a data URL rather than as a file on disk, so
-- it's the same wherever the app runs - in its own table so the many "SELECT * FROM clients"
-- queries never carry the image along. Served by GET /api/clients/:id/logo.
CREATE TABLE IF NOT EXISTS client_logos (
  client_id   TEXT PRIMARY KEY REFERENCES clients(client_id) ON DELETE CASCADE,
  logo_data   TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT now_utc_text()
);
