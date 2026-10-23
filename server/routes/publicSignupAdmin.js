// Office side of public interest sign-up (Keeley's request, 2026-10-23) - mounted at
// /api/training-sessions behind requireAuth, alongside routes/trainingSessions.js. Opens a class's
// sign-up page, sets the page text, and lists who's interested.
const crypto = require('crypto');
const express = require('express');
const { dbGet, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../lib/activityLog');
const { publicSignupUrl, peopleCount, listRegistrations } = require('../lib/publicSignup');

const router = express.Router();

async function getSession(id) {
  return dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [id]);
}

async function signupPayload(session) {
  return {
    open: Boolean(session.public_signup_open),
    url: session.public_signup_token ? publicSignupUrl(session.public_signup_token) : null,
    link_name: session.public_signup_token || '',
    class_hours: session.public_class_hours || '',
    details: session.public_details || '',
    people: await peopleCount(session.session_id),
    registrations: await listRegistrations(session.session_id),
  };
}

router.get('/:id/public-signup', requireAdmin, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(await signupPayload(session));
});

// The link name the office picks for the page (Keeley's request, 2026-10-23: "esr-training.com/
// register/osha30") - lowercase letters, numbers and dashes. Blank keeps the current one, or makes
// a random one the first time.
const LINK_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

router.put('/:id/public-signup', requireAdmin, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const body = req.body || {};
  const open = Boolean(body.open);
  const typed = String(body.link_name || '').trim();
  // Left as it was (including an older random code) - nothing to check.
  const linkName = typed === session.public_signup_token ? '' : typed.toLowerCase();
  if (linkName && (linkName.length < 3 || linkName.length > 60 || !LINK_NAME_PATTERN.test(linkName))) {
    return res.status(400).json({ error: 'The link name can only use letters, numbers and dashes (3 to 60 characters), like osha30 or osha-30-nov.' });
  }
  if (linkName) {
    const taken = await dbGet('SELECT session_id FROM training_sessions WHERE lower(public_signup_token) = ? AND session_id <> ?', [linkName, session.session_id]);
    if (taken) return res.status(409).json({ error: `The link name "${linkName}" is already used by another class. Please pick a different one.` });
  }
  const token = linkName || session.public_signup_token || crypto.randomBytes(9).toString('base64url');
  await dbRun(
    'UPDATE training_sessions SET public_signup_token = ?, public_signup_open = ?, public_class_hours = ?, public_details = ? WHERE session_id = ?',
    [
      token, open ? 1 : 0,
      String(body.class_hours || '').trim().slice(0, 100) || null,
      String(body.details || '').trim().slice(0, 2000) || null,
      session.session_id,
    ]
  );
  logActivity({
    actor: req.user, action: open ? 'public_signup_opened' : 'public_signup_saved', entityType: 'training_session',
    entityId: session.session_id, entityLabel: session.training_type_label, req,
  });
  res.json(await signupPayload(await getSession(session.session_id)));
});

router.delete('/:id/public-registrations/:registrationId', requireAdmin, async (req, res) => {
  const registration = await dbGet(
    'SELECT * FROM public_registrations WHERE session_id = ? AND registration_id = ?',
    [req.params.id, req.params.registrationId]
  );
  if (!registration) return res.status(404).json({ error: 'Sign-up not found' });
  await dbRun('DELETE FROM public_registrations WHERE registration_id = ?', [registration.registration_id]);
  logActivity({
    actor: req.user, action: 'public_registration_deleted', entityType: 'training_session', entityId: req.params.id,
    entityLabel: `${registration.contact_first_name} ${registration.contact_last_name} (${registration.seats} ${registration.seats === 1 ? 'person' : 'people'})`, req,
  });
  res.status(204).end();
});

module.exports = router;
