// Employee/trainer portal API (Keeley's request, 2026-09-30) - mounted at /api/portal WITHOUT the
// office login; its own cookie (lib/portal.js). Every route past sign-in only ever touches the
// profiles that share the signed-in email.
const fs = require('fs');
const express = require('express');
const { dbGet, dbRun } = require('../db');
const portal = require('../lib/portal');
const { notifyAllUsers } = require('../lib/notifications');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { displayFirstLast } = require('../lib/names');

const router = express.Router();

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: portal.SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

async function loadSession(req) {
  return portal.sessionFromToken(req.cookies?.[portal.COOKIE_NAME]);
}

// Signed in, or answer 401 (the page then shows the sign-in form).
async function requirePortal(req, res, next) {
  const session = await loadSession(req);
  if (!session) {
    res.clearCookie(portal.COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Please sign in.' });
  }
  req.portal = session;
  return next();
}

function ownProfile(req, employeeId) {
  return req.portal.profiles.find((p) => p.employee_id === employeeId) || null;
}

router.post('/request-code', async (req, res) => {
  try {
    await portal.requestLoginCode(req.body?.email);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Portal code email failed:', err.message);
  }
  // Same answer whether or not the email is invited, so the form can't be used to find out who is.
  res.json({ ok: true });
});

router.post('/verify', async (req, res) => {
  const token = await portal.verifyLoginCode(req.body?.email, req.body?.code);
  if (!token) return res.status(400).json({ error: "That code didn't work. Check it, or request a new one." });
  res.cookie(portal.COOKIE_NAME, token, cookieOptions(req));
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  await portal.endSession(req.cookies?.[portal.COOKIE_NAME]);
  res.clearCookie(portal.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requirePortal, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await portal.portalData(req.portal));
});

router.put('/profiles/:employeeId/phone', requirePortal, async (req, res) => {
  const profile = ownProfile(req, req.params.employeeId);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  const phone = String(req.body?.phone || '').trim();
  if (!isValidPhoneNumber(phone)) return res.status(400).json({ error: 'Enter a 10-digit phone number.' });
  const formatted = formatPhoneNumber(phone);
  if (formatted === profile.employee_number) return res.json({ ok: true, phone: formatted });
  await dbRun('UPDATE employees SET employee_number = ? WHERE employee_id = ?', [formatted, profile.employee_id]);
  await notifyAllUsers({
    type: 'portal_profile_updated',
    title: `${displayFirstLast(profile)} updated their phone number`,
    body: `${profile.employee_number || 'none'} → ${formatted} (in the ESR Training Portal)`,
    link_path: `/employees/${profile.employee_id}`,
    email: false,
  });
  res.json({ ok: true, phone: formatted });
});

router.post('/email-change', requirePortal, async (req, res) => {
  try {
    await portal.requestEmailChange(req.portal, req.body?.new_email);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/email-change/confirm', requirePortal, async (req, res) => {
  const newEmail = await portal.confirmEmailChange(req.portal, req.body?.code);
  if (!newEmail) return res.status(400).json({ error: "That code didn't work. Check it, or send a new one." });
  for (const profile of req.portal.profiles) {
    // eslint-disable-next-line no-await-in-loop
    await notifyAllUsers({
      type: 'portal_profile_updated',
      title: `${displayFirstLast(profile)} updated their email`,
      body: `${req.portal.email} → ${newEmail} (confirmed in the ESR Training Portal)`,
      link_path: `/employees/${profile.employee_id}`,
      email: false,
    });
  }
  res.json({ ok: true, email: newEmail });
});

router.get('/records/:recordId/certificate', requirePortal, async (req, res) => {
  const record = await dbGet('SELECT * FROM employee_training_records WHERE record_id = ?', [req.params.recordId]);
  if (!record || !ownProfile(req, record.employee_id) || !record.certificate_path || !fs.existsSync(record.certificate_path)) {
    return res.status(404).json({ error: 'No certificate on file for this training.' });
  }
  res.download(record.certificate_path, record.certificate_filename || 'certificate.pdf');
});

router.get('/documents/:documentId', requirePortal, async (req, res) => {
  const doc = await dbGet('SELECT * FROM employee_documents WHERE document_id = ?', [req.params.documentId]);
  if (!doc || !ownProfile(req, doc.employee_id) || !fs.existsSync(doc.file_path)) {
    return res.status(404).json({ error: 'Document not found.' });
  }
  res.download(doc.file_path, doc.filename);
});

module.exports = router;
