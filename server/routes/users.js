const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword } = require('../lib/auth');

// Mounted with requireAuth in server/index.js - every route below already requires a
// logged-in session.

router.get('/', (req, res) => {
  const users = db.prepare('SELECT user_id, username, created_at FROM app_users ORDER BY created_at ASC').all();
  res.json(users);
});

router.post('/', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUsername = (username || '').trim();
  if (!cleanUsername || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const existing = db.prepare('SELECT 1 FROM app_users WHERE username = ?').get(cleanUsername);
  if (existing) return res.status(409).json({ error: 'That username is already in use.' });

  const user = {
    user_id: uuidv4(),
    username: cleanUsername,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO app_users (user_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(user.user_id, user.username, user.password_hash, user.created_at);

  res.status(201).json({ user_id: user.user_id, username: user.username, created_at: user.created_at });
});

router.put('/:userId/password', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const user = db.prepare('SELECT * FROM app_users WHERE user_id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('UPDATE app_users SET password_hash = ? WHERE user_id = ?').run(hashPassword(password), user.user_id);
  res.json({ ok: true });
});

router.delete('/:userId', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM app_users').get().n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining login account.' });

  const result = db.prepare('DELETE FROM app_users WHERE user_id = ?').run(req.params.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true });
});

module.exports = router;
