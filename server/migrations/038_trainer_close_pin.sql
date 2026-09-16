CREATE TABLE IF NOT EXISTS trainer_close_pin_settings (
  id    TEXT PRIMARY KEY DEFAULT 'default',
  pin   TEXT NOT NULL
);

INSERT INTO trainer_close_pin_settings (id, pin)
VALUES ('default', '2026')
ON CONFLICT (id) DO NOTHING;
