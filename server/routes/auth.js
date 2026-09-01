const express = require('express');
const router = express.Router();
const { dbGet } = require('../db');
const { verifyPassword, signToken } = require('../lib/auth');
const { getOrCreateSessionSecret } = require('../lib/settings');
const { COOKIE_NAME, SESSION_MS } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = await dbGet('SELECT * FROM app_users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const secret = await getOrCreateSessionSecret();
  const token = signToken({ sub: user.user_id, username: user.username }, secret, SESSION_MS);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_MS,
  });
  res.json({ ok: true, username: user.username, role: user.role });
});

router.post('/logout', async (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ username: req.user.username, role: req.user.role });
});

module.exports = router;
