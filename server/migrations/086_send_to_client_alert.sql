-- "Send this training to the client" bell alert, 24 hours after a session closes if Sent to Client
-- still isn't ticked (Keeley's request, 2026-10-21). Set when the alert goes out, so each session
-- is alerted once.
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS send_to_client_alert_at TEXT;
