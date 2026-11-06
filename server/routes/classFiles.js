// A class's PowerPoint downloads (migration 091) - the links in the trainer's class summary email
// and Training Portal. Public like the rest of the trainer links (trainers have no office login),
// keyed by the session's own random files_token, which can't sign anyone in or leave feedback.
const express = require('express');
const { dbGet } = require('../db');
const { sendClassDeck } = require('../lib/classPowerpoints');

const router = express.Router();

router.get('/:token/:key', async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(req.params.token) || !/^\d{1,2}-\d{1,3}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'This download link isn\'t valid.' });
  }
  const session = await dbGet('SELECT * FROM training_sessions WHERE files_token = ?', [req.params.token]);
  if (!session) return res.status(404).json({ error: 'This download link isn\'t valid. Contact the ESR office.' });
  return sendClassDeck(session, req.params.key, res);
});

module.exports = router;
