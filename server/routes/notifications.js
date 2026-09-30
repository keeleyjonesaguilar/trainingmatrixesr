// Backs the bell icon in the top bar (client/src/components/NotificationBell.jsx). Mounted with
// requireAuth in server/index.js - every route below is scoped to req.user, never another
// account's notifications.
const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');

const router = express.Router();

// A notification is cleared 24 hours after it's read; unread ones stay until read (Keeley's
// request, 2026-09-30). read_at is UTC text, so it compares directly against this cutoff.
const READ_CUTOFF_SQL = "to_char((now() AT TIME ZONE 'utc') - interval '24 hours', 'YYYY-MM-DD HH24:MI:SS')";

router.get('/', async (req, res) => {
  await dbRun(`DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL AND read_at < ${READ_CUTOFF_SQL}`, [req.user.user_id]);
  const notifications = await dbAll(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.user_id]
  );
  const { n: unreadCount } = await dbGet(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [req.user.user_id]
  );
  res.json({ notifications, unread_count: unreadCount });
});

router.post('/:id/read', async (req, res) => {
  await dbRun(
    'UPDATE notifications SET read_at = now_utc_text() WHERE notification_id = ? AND user_id = ? AND read_at IS NULL',
    [req.params.id, req.user.user_id]
  );
  res.json({ ok: true });
});

router.post('/mark-all-read', async (req, res) => {
  await dbRun(
    'UPDATE notifications SET read_at = now_utc_text() WHERE user_id = ? AND read_at IS NULL',
    [req.user.user_id]
  );
  res.json({ ok: true });
});

module.exports = router;
module.exports.READ_CUTOFF_SQL = READ_CUTOFF_SQL;
