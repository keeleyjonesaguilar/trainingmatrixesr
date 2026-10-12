// Change requests (migration 079, Keeley's request, 2026-10-12) - the office's list of changes and
// updates people would find useful, instead of passing them on verbally. Mounted with requireAuth:
// anyone signed in can submit and see the list; only the Super Admin sets the status (and can
// leave a note back). New requests ping the Super Admin's bell; a status change pings whoever asked.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['change', 'new_feature', 'problem', 'other'];
const PRIORITIES = ['nice_to_have', 'important', 'urgent'];
const STATUSES = ['new', 'planned', 'in_progress', 'done', 'not_doing'];
const STATUS_LABELS = { new: 'New', planned: 'Planned', in_progress: 'In progress', done: 'Done', not_doing: 'Not doing' };

async function notify(userIds, { title, body, linkPath }) {
  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      'INSERT INTO notifications (notification_id, user_id, type, title, body, link_path) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), userId, 'change_request', title, body || null, linkPath]
    );
  }
}

// `mine` - so the page knows which requests the person looking can edit or withdraw.
function withMine(row, req) {
  return row && { ...row, mine: row.submitted_by === req.user.user_id };
}

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await dbAll('SELECT * FROM change_requests ORDER BY created_at DESC', []);
  res.json(rows.map((r) => withMine(r, req)));
});

router.post('/', async (req, res) => {
  const title = clean(req.body?.title, 200);
  if (!title) return res.status(400).json({ error: 'Say what would help, in a few words.' });
  const category = CATEGORIES.includes(req.body?.category) ? req.body.category : 'change';
  const priority = PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'nice_to_have';
  const requestId = uuidv4();
  const submittedBy = req.user.full_name || req.user.username;
  await dbRun(
    `INSERT INTO change_requests (request_id, title, details, category, area, priority, submitted_by, submitted_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestId, title, clean(req.body?.details, 5000) || null, category, clean(req.body?.area, 100) || null, priority, req.user.user_id, submittedBy]
  );
  const admins = await dbAll("SELECT user_id FROM app_users WHERE role = 'super_admin' AND user_id <> ?", [req.user.user_id]);
  await notify(admins.map((a) => a.user_id), {
    title: `New request from ${submittedBy}${priority === 'urgent' ? ' (urgent)' : ''}`,
    body: title,
    linkPath: `/requests?open=${requestId}`,
  });
  res.status(201).json(withMine(await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [requestId]), req));
});

// The person who asked can fix their own request while it's still New; the Super Admin any time.
router.put('/:id', async (req, res) => {
  const existing = await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  const isOwner = existing.submitted_by === req.user.user_id;
  if (req.user.role !== 'super_admin' && !(isOwner && existing.status === 'new')) {
    return res.status(403).json({ error: 'Only the person who asked can change a request, and only while it is still New.' });
  }
  const title = clean(req.body?.title ?? existing.title, 200);
  if (!title) return res.status(400).json({ error: 'Say what would help, in a few words.' });
  await dbRun(
    `UPDATE change_requests SET title = ?, details = ?, category = ?, area = ?, priority = ?, updated_at = now_utc_text() WHERE request_id = ?`,
    [
      title,
      clean(req.body?.details ?? existing.details, 5000) || null,
      CATEGORIES.includes(req.body?.category) ? req.body.category : existing.category,
      clean(req.body?.area ?? existing.area, 100) || null,
      PRIORITIES.includes(req.body?.priority) ? req.body.priority : existing.priority,
      req.params.id,
    ]
  );
  res.json(withMine(await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [req.params.id]), req));
});

router.put('/:id/status', requireSuperAdmin, async (req, res) => {
  const existing = await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  const status = STATUSES.includes(req.body?.status) ? req.body.status : existing.status;
  const note = clean(req.body?.status_note ?? existing.status_note, 2000) || null;
  await dbRun(
    `UPDATE change_requests SET status = ?, status_note = ?, status_changed_by = ?, status_changed_at = now_utc_text(), updated_at = now_utc_text()
     WHERE request_id = ?`,
    [status, note, req.user.full_name || req.user.username, req.params.id]
  );
  if ((status !== existing.status || note !== existing.status_note) && existing.submitted_by !== req.user.user_id) {
    await notify([existing.submitted_by], {
      title: status !== existing.status ? `Your request is now ${STATUS_LABELS[status]}` : 'A note was added to your request',
      body: existing.title,
      linkPath: `/requests?open=${existing.request_id}`,
    });
  }
  res.json(withMine(await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [req.params.id]), req));
});

// The person who asked can withdraw it while it's still New; the Super Admin can remove any.
router.delete('/:id', async (req, res) => {
  const existing = await dbGet('SELECT * FROM change_requests WHERE request_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  if (req.user.role !== 'super_admin' && !(existing.submitted_by === req.user.user_id && existing.status === 'new')) {
    return res.status(403).json({ error: 'Only the person who asked can withdraw a request, and only while it is still New.' });
  }
  await dbRun('DELETE FROM change_requests WHERE request_id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
