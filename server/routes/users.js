const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword } = require('../lib/auth');
const { requireAdmin } = require('../middleware/auth');

// Mounted with requireAuth in server/index.js - every route below already requires a
// logged-in session. Managing accounts/roles is admin-only; viewing the list is fine for
// anyone logged in (so a read-only user can at least see who has access).

router.get('/', (req, res) => {
  const users = db.prepare('SELECT user_id, username, role, created_at FROM app_users ORDER BY created_at ASC').all();
  res.json(users);
});

router.post('/', requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  const cleanUsername = (username || '').trim();
  if (!cleanUsername || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." });

  const existing = db.prepare('SELECT 1 FROM app_users WHERE username = ?').get(cleanUsername);
  if (existing) return res.status(409).json({ error: 'That username is already in use.' });

  const user = {
    user_id: uuidv4(),
    username: cleanUsername,
    password_hash: hashPassword(password),
    role,
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO app_users (user_id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.user_id, user.username, user.password_hash, user.role, user.created_at);

  res.status(201).json({ user_id: user.user_id, username: user.username, role: user.role, created_at: user.created_at });
});

router.put('/:userId/password', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = db.prepare('SELECT * FROM app_users WHERE user_id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('UPDATE app_users SET password_hash = ? WHERE user_id = ?').run(hashPassword(password), user.user_id);
  res.json({ ok: true });
});

// Change a user's role. Blocked if it would leave zero admin accounts - otherwise a mistake
// here could lock everyone out of ever managing users/roles again.
router.put('/:userId/role', requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." });

  const user = db.prepare('SELECT * FROM app_users WHERE user_id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.role === 'admin' && role === 'user') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining admin account.' });
  }

  db.prepare('UPDATE app_users SET role = ? WHERE user_id = ?').run(role, user.user_id);
  res.json({ ok: true });
});

router.delete('/:userId', requireAdmin, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining login account.' });

  const user = db.prepare('SELECT * FROM app_users WHERE user_id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining admin account.' });
  }

  db.prepare('DELETE FROM app_users WHERE user_id = ?').run(req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
