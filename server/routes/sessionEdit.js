// The trainer's post-close "Edit close-out details" page (Keeley's request, 2026-09-24: e.g. the
// address wasn't known at close-out, or someone signed in twice). Public like routes/
// publicSessions.js - trainers have no login - and mounted at /api/session-edit in
// server/index.js. Two things guard it: the link's secret edit_token (emailed only in the
// trainer's close-out email, or copied by an admin), and the same trainer PIN that closing a
// session requires, which every call past the page header must include.
const express = require('express');
const { dbGet, dbAll, dbRun } = require('../db');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { removeAttendee } = require('../lib/sessionRecords');
const { logActivity } = require('../lib/activityLog');
const {
  AHA_ROSTER_TRAINING_ID, AHA_FIELDS, ahaColumnsFromBody, getSessionWithClient, regenerateRosters, sendCompletedFormsEmail,
} = require('../lib/sessionCloseOut');

const router = express.Router();

// Same pattern as routes/publicSessions.js's EMAIL_PATTERN.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getSessionByEditToken(editToken) {
  const row = await dbGet('SELECT session_id FROM training_sessions WHERE edit_token = ?', [String(editToken || '')]);
  return row ? getSessionWithClient(row.session_id) : null;
}

// Same case-insensitive, admin-editable PIN the close-out form checks.
async function pinMatches(pin) {
  const setting = await dbGet('SELECT pin FROM trainer_close_pin_settings WHERE id = ?', ['default']);
  return String(pin || '').trim().toUpperCase() === String(setting?.pin || '').trim().toUpperCase();
}

// Resolves the session and checks the PIN, answering the request itself on any failure.
async function unlockedSession(req, res) {
  const session = await getSessionByEditToken(req.params.editToken);
  if (!session) {
    res.status(404).json({ error: "This edit link isn't valid." });
    return null;
  }
  if (session.status !== 'closed') {
    res.status(400).json({ error: "This session hasn't been closed yet - use the sign-in page to close it out first." });
    return null;
  }
  if (!(await pinMatches(req.body?.pin))) {
    res.status(400).json({ error: 'Incorrect PIN.' });
    return null;
  }
  return session;
}

function parseList(json) {
  try {
    const value = JSON.parse(json || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function sessionDetails(session) {
  const attendees = await dbAll(
    `SELECT attendee_id, trainee_name, trainee_phone, trainee_email, trainee_job_title, signed_at, processing_status
     FROM session_attendees WHERE session_id = ? ORDER BY signed_at`,
    [session.session_id]
  );
  const aha = {};
  for (const field of AHA_FIELDS) {
    aha[field] = ['hs_course_options', 'hs_optional_topics', 'hs_additional_instructors'].includes(field)
      ? parseList(session[field])
      : session[field] || '';
  }
  return {
    trainer_signed_name: session.trainer_signed_name || session.trainer_name,
    trainer_email: session.trainer_email || '',
    trainer_phone: session.trainer_phone || '',
    is_aha: session.master_training_id === AHA_ROSTER_TRAINING_ID,
    aha,
    attendees,
  };
}

// Page header - enough to show which session this is before the PIN is entered, nothing more.
router.get('/:editToken', async (req, res) => {
  const session = await getSessionByEditToken(req.params.editToken);
  if (!session) return res.status(404).json({ error: "This edit link isn't valid." });
  res.json({
    client_name: session.client_name,
    training_type_label: session.training_type_label,
    session_date: session.session_date,
    status: session.status,
  });
});

// PIN entered - everything the edit form shows.
router.post('/:editToken/unlock', async (req, res) => {
  const session = await unlockedSession(req, res);
  if (!session) return;
  res.json(await sessionDetails(session));
});

router.post('/:editToken/save', async (req, res) => {
  const session = await unlockedSession(req, res);
  if (!session) return;
  const body = req.body || {};
  const trainerEmail = String(body.trainer_email || '').trim();
  const trainerPhone = String(body.trainer_phone || '').trim();
  if (!trainerEmail || !EMAIL_PATTERN.test(trainerEmail)) {
    return res.status(400).json({ error: 'Please enter a valid trainer email address.' });
  }
  if (!trainerPhone || !isValidPhoneNumber(trainerPhone)) {
    return res.status(400).json({ error: 'Please enter a standard 10-digit trainer phone number.' });
  }

  // AHA fields only change on First Aid/CPR/AED sessions - anywhere else they don't print, so
  // they're left exactly as they were.
  const ahaColumns = session.master_training_id === AHA_ROSTER_TRAINING_ID ? ahaColumnsFromBody(body) : {};
  await dbRun(
    `UPDATE training_sessions
     SET ${['trainer_email = ?', 'trainer_phone = ?', ...Object.keys(ahaColumns).map((col) => `${col} = ?`)].join(', ')}
     WHERE session_id = ?`,
    [trainerEmail.toLowerCase(), formatPhoneNumber(trainerPhone), ...Object.values(ahaColumns), session.session_id]
  );

  const removeIds = Array.isArray(body.remove_attendee_ids) ? body.remove_attendee_ids.map(String) : [];
  const removedNames = [];
  for (const attendeeId of removeIds) {
    // eslint-disable-next-line no-await-in-loop
    const removed = await removeAttendee(session.session_id, attendeeId);
    if (removed) removedNames.push(removed.trainee_name);
  }

  const updatedSession = await getSessionWithClient(session.session_id);
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY signed_at', [session.session_id]);
  const additionalTrainings = await dbAll(
    'SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order',
    [session.session_id]
  );
  const { rosterPath, ahaRosterPath } = await regenerateRosters(updatedSession, attendees, additionalTrainings);
  const trainerProfileEmail = updatedSession.trainer_employee_id
    ? (await dbGet('SELECT email FROM employees WHERE employee_id = ?', [updatedSession.trainer_employee_id]))?.email || null
    : null;
  await sendCompletedFormsEmail({
    session: updatedSession, additionalTrainings, attendees, rosterPath, ahaRosterPath, trainerProfileEmail, isUpdate: true,
  });

  logActivity({
    actor: { user_id: null, username: `Trainer: ${updatedSession.trainer_signed_name || updatedSession.trainer_name}` },
    action: 'session_edited_by_trainer',
    entityType: 'training_session',
    entityId: session.session_id,
    entityLabel: `${updatedSession.training_type_label} · ${updatedSession.client_name}`,
    details: removedNames.length ? `Removed: ${removedNames.join(', ')}` : null,
    req,
  });
  res.json({ ok: true, removed_count: removedNames.length, ...(await sessionDetails(updatedSession)) });
});

module.exports = router;
