const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { hashPassword } = require('../lib/auth');
const { requireAdmin } = require('../middleware/auth');

// Mounted with requireAuth in server/index.js - every route below already requires a
// logged-in session. Managing accounts/roles is admin-only; viewing the list is fine for
// anyone logged in (so a read-only user can at least see who has access).

router.get('/', async (req, res) => {
  const users = await dbAll('SELECT user_id, username, role, created_at FROM app_users ORDER BY created_at ASC', []);
  res.json(users);
});

router.post('/', requireAdmin, async (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  const cleanUsername = (username || '').trim();
  if (!cleanUsername || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." });

  const existing = await dbGet('SELECT 1 FROM app_users WHERE username = ?', [cleanUsername]);
  if (existing) return res.status(409).json({ error: 'That username is already in use.' });

  const user = {
    user_id: uuidv4(),
    username: cleanUsername,
    password_hash: hashPassword(password),
    role,
    created_at: new Date().toISOString(),
  };
  await dbRun('INSERT INTO app_users (user_id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.user_id, user.username, user.password_hash, user.role, user.created_at]);

  res.status(201).json({ user_id: user.user_id, username: user.username, role: user.role, created_at: user.created_at });
});

router.put('/:userId/password', requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  await dbRun('UPDATE app_users SET password_hash = ? WHERE user_id = ?', [hashPassword(password), user.user_id]);
  res.json({ ok: true });
});

// Change a user's role. Blocked if it would leave zero admin accounts - otherwise a mistake
// here could lock everyone out of ever managing users/roles again.
router.put('/:userId/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.role === 'admin' && role === 'user') {
    const adminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin'", [])).n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining admin account.' });
  }

  await dbRun('UPDATE app_users SET role = ? WHERE user_id = ?', [role, user.user_id]);
  res.json({ ok: true });
});

router.delete('/:userId', requireAdmin, async (req, res) => {
  const count = (await dbGet('SELECT COUNT(*) AS n FROM app_users', [])).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining login account.' });

  const user = await dbGet('SELECT * FROM app_users WHERE user_id = ?', [req.params.userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') {
    const adminCount = (await dbGet("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin'", [])).n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining admin account.' });
  }

  await dbRun('DELETE FROM app_users WHERE user_id = ?', [req.params.userId]);
  res.json({ ok: true });
});

module.exports = router;
