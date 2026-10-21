// Backs the bell icon in the top bar (client/src/components/NotificationBell.jsx). Mounted with
// requireAuth in server/index.js - every route below is scoped to req.user, never another
// account's notifications.
const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');

const router = express.Router();

// A notification is cleared 24 hours after it's read; unread ones stay until read (Keeley's
// request, 2026-09-30). read_at is UTC text, so it compares directly against this cutoff.
const READ_CUTOFF_SQL = "to_char((now() AT TIME ZONE 'utc') - interval '24 hours', 'YYYY-MM-DD HH24:MI:SS')";

// The bell's tabs (Keeley's request, 2026-10-14: the one list was "clogged up"). Needs attention =
// someone has to act on it; Completed = closed trainings; Updates = everything else, for your
// information. A new notification type lands in Updates until it's added here.
const ATTENTION_TYPES = [
  'feedback_needs_training', 'trainer_summary_missing_email', 'session_email_problem', 'session_reminder', 'trainer_notes',
  'send_to_client',
];
const COMPLETED_TYPES = ['session_completed'];
const GROUPS = ['attention', 'completed', 'updates'];
const PER_GROUP = 50;

function groupOf(type) {
  if (ATTENTION_TYPES.includes(type)) return 'attention';
  if (COMPLETED_TYPES.includes(type)) return 'completed';
  return 'updates';
}

// SQL condition for one group's types.
function groupSql(group) {
  const all = [...ATTENTION_TYPES, ...COMPLETED_TYPES];
  if (group === 'attention') return { sql: 'type = ANY(?)', params: [ATTENTION_TYPES] };
  if (group === 'completed') return { sql: 'type = ANY(?)', params: [COMPLETED_TYPES] };
  return { sql: 'NOT (type = ANY(?))', params: [all] };
}

router.get('/', async (req, res) => {
  await dbRun(`DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL AND read_at < ${READ_CUTOFF_SQL}`, [req.user.user_id]);
  // Each tab gets its own newest 50, so a busy day of closed trainings never pushes an item that
  // needs attention out of the list.
  const groups = {};
  for (const group of GROUPS) {
    const { sql, params } = groupSql(group);
    // eslint-disable-next-line no-await-in-loop
    const items = await dbAll(
      `SELECT * FROM notifications WHERE user_id = ? AND ${sql} ORDER BY created_at DESC LIMIT ${PER_GROUP}`,
      [req.user.user_id, ...params]
    );
    // eslint-disable-next-line no-await-in-loop
    const { n } = await dbGet(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL AND ${sql}`, [req.user.user_id, ...params]);
    groups[group] = { items: items.map((x) => ({ ...x, group })), unread: n };
  }
  const notifications = GROUPS.flatMap((g) => groups[g].items).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json({
    notifications,
    groups,
    unread_count: GROUPS.reduce((sum, g) => sum + groups[g].unread, 0),
  });
});

router.post('/:id/read', async (req, res) => {
  await dbRun(
    'UPDATE notifications SET read_at = now_utc_text() WHERE notification_id = ? AND user_id = ? AND read_at IS NULL',
    [req.params.id, req.user.user_id]
  );
  res.json({ ok: true });
});

// `group` (optional) marks just that tab read.
router.post('/mark-all-read', async (req, res) => {
  const group = req.body?.group;
  if (group && !GROUPS.includes(group)) return res.status(400).json({ error: 'Unknown notification group.' });
  const { sql, params } = group ? groupSql(group) : { sql: 'TRUE', params: [] };
  await dbRun(
    `UPDATE notifications SET read_at = now_utc_text() WHERE user_id = ? AND read_at IS NULL AND ${sql}`,
    [req.user.user_id, ...params]
  );
  res.json({ ok: true });
});

module.exports = router;
module.exports.READ_CUTOFF_SQL = READ_CUTOFF_SQL;
module.exports.groupOf = groupOf;
