// Class details request (migration 096, Keeley 2026-11-16) - when a training is created, the people
// ticked for "Class details requests" on Manage Users (Guy and Jayna to start) are emailed a link to
// the session's Class Needs card. Saving that card marks the request done (routes/trainingSessions.js
// PATCH /:id/needs) and bells the office. No review step - the 10/07 prep workflow had one and was
// rolled back.
const { dbGet, dbAll, dbRun } = require('../db');
const { sendEmail } = require('./email');
const { sessionTrainers } = require('./sessionDays');
const { stripTrainingIdPrefix } = require('./certificateFilename');
const {
  emailShell, panel, listPanel, esc, clockTime, publicBaseUrl, sessionDatesText,
} = require('./trainerSummary');

const GREEN = '#006b54';
const FIELDS = [
  'Number of students', 'Room layout', 'Site contact name and phone', 'AV hookup',
  'Company contact email for the roster', 'Anything else the class needs',
];

function personName(u) {
  return String(u.full_name || '').trim() || u.email;
}

async function requestRecipients() {
  return dbAll(
    "SELECT user_id, username, full_name, email FROM app_users WHERE gets_class_needs_requests = 1 AND email IS NOT NULL AND email <> '' ORDER BY full_name, username",
    []
  );
}

function buildRequestEmail(s, trainingLabel, trainerNames, person) {
  const first = String(person.full_name || '').trim().split(/\s+/)[0];
  const url = `${publicBaseUrl()}/sessions/${s.session_id}?needs=1`;
  const button = `<div style="margin:16px 0 4px;"><a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:10px 18px;border-radius:6px;">Fill in class details</a></div>`;
  return {
    subject: `Class details needed: ${trainingLabel} – ${s.client_name} – ${sessionDatesText(s)}`,
    html: emailShell({
      kicker: 'Class details needed',
      title: trainingLabel,
      intro: `<p style="margin:0;">Hi ${esc(first || 'there')},</p>`
        + '<p style="margin:8px 0 0;">A new training was just scheduled. Please fill in the class details on the Training Matrix - every box is optional, so fill in what you know.</p>'
        + button
        + '<p style="margin:8px 0 0;font-size:13px;color:#5b6470;">It saves straight onto the training session, and the trainer sees it in their class summary.</p>',
      panels: [
        panel('The class', [
          ['Client', esc(s.client_name)],
          ['Date', esc(sessionDatesText(s))],
          s.start_time ? ['Start time', esc(clockTime(s.start_time))] : null,
          s.location ? ['Location', esc(s.location)] : null,
          trainerNames.length ? [trainerNames.length > 1 ? 'Trainers' : 'Trainer', esc(trainerNames.join(', '))] : null,
        ]),
        listPanel('What to fill in (all optional)', FIELDS.map(esc)),
      ],
    }),
  };
}

// Emails the request for one session. Returns { sent_to: [names], failed: [emails] }, or
// { skipped } for a toolbox talk / nobody set up to get it.
async function sendClassNeedsRequest(sessionId) {
  const s = await dbGet(
    'SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?',
    [sessionId]
  );
  if (!s) return { error: 'Session not found.' };
  if (s.session_kind === 'toolbox_talk') return { skipped: 'toolbox_talk', sent_to: [], failed: [] };
  const people = await requestRecipients();
  if (!people.length) return { skipped: 'no_recipients', sent_to: [], failed: [] };

  const extras = await dbAll('SELECT training_type_label FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const trainingLabel = [s.training_type_label, ...extras.map((e) => e.training_type_label)].map(stripTrainingIdPrefix).join(' + ');
  const trainerNames = (await sessionTrainers(s)).map((t) => t.name);

  const sent = [];
  const failed = [];
  for (const person of people) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: person.email, ...buildRequestEmail(s, trainingLabel, trainerNames, person) });
      sent.push(personName(person));
    } catch (err) {
      failed.push(person.email);
      console.error(`Class details request to ${person.email} failed:`, err.message); // eslint-disable-line no-console
    }
  }
  if (sent.length) {
    // A new request starts over - it's done again once someone saves the card.
    await dbRun(
      'UPDATE training_sessions SET needs_requested_at = ?, needs_requested_to = ?, needs_completed_at = NULL, needs_completed_by = NULL WHERE session_id = ?',
      [new Date().toISOString(), sent.join(', '), sessionId]
    );
  }
  return { sent_to: sent, failed };
}

// For create: an email problem never fails the save itself.
async function sendClassNeedsRequestSafely(sessionId) {
  try {
    return await sendClassNeedsRequest(sessionId);
  } catch (err) {
    console.error('Class details request failed:', err.message); // eslint-disable-line no-console
    return { error: 'The class details request could not be sent.', sent_to: [], failed: [] };
  }
}

module.exports = { sendClassNeedsRequest, sendClassNeedsRequestSafely, buildRequestEmail, requestRecipients };
