// What happens after a session's roster changes or its sign-off details are saved: rebuild the
// roster PDFs and email the completed forms. Shared by the trainer's close-out
// (routes/publicSessions.js), the trainer's post-close edit link (routes/sessionEdit.js), and an
// admin adding/removing an attendee after close (routes/trainingSessions.js), so all of them
// produce the same documents and the same email.
const crypto = require('crypto');
const fs = require('fs');
const { dbGet, dbAll, dbRun } = require('../db');
const { generateRosterPdf } = require('./pdfGen');
const { generateAhaRoster } = require('./ahaRoster');
const { buildRosterFilename, stripTrainingIdPrefix } = require('./certificateFilename');
const { listCertificateFiles, certificateZipName, certificateZipBuffer } = require('./certificateZip');
const { buildSessionCompleteEmail } = require('./sessionCompleteEmail');
const { sendEmail } = require('./email');
const { withDayTrainers, getCoTrainers } = require('./sessionDays');
const { sessionFeedbackSummary } = require('./sessionFeedback');
const { isMultiTrainingDay, trainingParts } = require('./sessionParts');

// The one training that also gets the official AHA Heartsaver Course Roster (Keeley's request,
// 2026-09-21) - every other training uses the in-house roster/certificate only.
const AHA_ROSTER_TRAINING_ID = 'TRN-020';

// The AHA roster's sign-off fields, as the close-out form and the edit form both send them.
const AHA_TEXT_FIELDS = [
  'hs_training_center', 'hs_training_center_id', 'hs_training_site_name', 'hs_address', 'hs_city_state_zip',
  'hs_course_start', 'hs_course_end', 'hs_total_hours', 'hs_no_of_cards_issued', 'hs_student_manikin_ratio',
  'hs_issue_date_of_cards', 'hs_card_expiration_date',
];
const AHA_LIST_FIELDS = ['hs_course_options', 'hs_optional_topics', 'hs_additional_instructors'];
const AHA_FIELDS = [...AHA_TEXT_FIELDS, ...AHA_LIST_FIELDS];

// Request body -> { column: value } for every AHA field, ready to write. Lists are stored as JSON;
// assisting instructors are capped at the 8 rows the printed form has room for.
function ahaColumnsFromBody(body) {
  const columns = {};
  for (const field of AHA_TEXT_FIELDS) {
    const value = body[field];
    columns[field] = value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
  }
  for (const field of AHA_LIST_FIELDS) {
    const value = body[field];
    const list = Array.isArray(value) ? (field === 'hs_additional_instructors' ? value.slice(0, 8) : value) : null;
    columns[field] = list ? JSON.stringify(list) : null;
  }
  return columns;
}

async function getSessionWithClient(sessionId) {
  return dbGet(
    'SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?',
    [sessionId]
  );
}

async function ensureEditToken(sessionId) {
  const row = await dbGet('SELECT edit_token FROM training_sessions WHERE session_id = ?', [sessionId]);
  if (row?.edit_token) return row.edit_token;
  const token = crypto.randomBytes(24).toString('base64url');
  await dbRun('UPDATE training_sessions SET edit_token = ? WHERE session_id = ? AND edit_token IS NULL', [token, sessionId]);
  return (await dbGet('SELECT edit_token FROM training_sessions WHERE session_id = ?', [sessionId])).edit_token;
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

function sessionEditUrl(editToken) {
  return `${publicBaseUrl()}/session-edit/${editToken}`;
}

// Rebuilds the sign-in roster (listing every training the session covered) and, for First
// Aid/CPR/AED, the AHA roster, saving their paths on the session. Each is best-effort so one
// failing never blocks the other; a failed one comes back null.
async function regenerateRosters(sessionRow, attendees, additionalTrainings) {
  // Multi-day: every day's trainer and sign-off prints on the roster (lib/sessionDays.js).
  const session = await withDayTrainers(sessionRow);
  let rosterPath = null;
  let ahaRosterPath = null;
  try {
    const rosterSession = {
      ...session,
      training_type_label: [session.training_type_label, ...additionalTrainings.map((t) => t.training_type_label)].join(', '),
    };
    let rosterAttendees = attendees;
    // 2+ trainings with their own durations (sessions since 2026-10-05): each listed with its
    // duration; on a Multi Training Day, also which ones each person checked in for. Older sessions
    // have one duration for the whole day and keep the single Training/Duration lines.
    if (isMultiTrainingDay(session) || additionalTrainings.some((t) => t.duration)) {
      rosterSession.training_parts = await trainingParts(session, additionalTrainings);
    }
    if (isMultiTrainingDay(session)) {
      rosterSession.training_part_checkins = true;
      const checkins = await dbAll('SELECT attendee_id, day_number, signed_at, marked_by FROM session_attendance_days WHERE session_id = ?', [session.session_id]);
      rosterAttendees = attendees.map((a) => ({ ...a, part_checkins: checkins.filter((c) => c.attendee_id === a.attendee_id) }));
    }
    rosterPath = await generateRosterPdf(rosterSession, rosterAttendees);
    await dbRun('UPDATE training_sessions SET roster_pdf_path = ? WHERE session_id = ?', [rosterPath, session.session_id]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Roster PDF generation failed for session ${session.session_id}:`, err);
  }

  if (session.master_training_id === AHA_ROSTER_TRAINING_ID) {
    try {
      let trainerAhaInstructorId = null;
      if (session.trainer_employee_id) {
        const trainerEmployee = await dbGet('SELECT aha_instructor_id FROM employees WHERE employee_id = ?', [session.trainer_employee_id]);
        trainerAhaInstructorId = trainerEmployee?.aha_instructor_id || null;
      }
      ahaRosterPath = await generateAhaRoster({ ...session, trainer_aha_instructor_id: trainerAhaInstructorId }, attendees);
      await dbRun('UPDATE training_sessions SET hs_roster_pdf_path = ? WHERE session_id = ?', [ahaRosterPath, session.session_id]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`AHA roster generation failed for session ${session.session_id}:`, err);
    }
  }
  return { rosterPath, ahaRosterPath };
}

// Emails the completed forms - a certificate ZIP per training, the sign-in roster, and the AHA
// roster when there is one - to the trainer (sign-off and profile address) and every app user.
// One email per address so recipients never see each other's; each send has its own catch so one
// bad address (or email not being configured - see ./email.js) never blocks the rest. Only the
// trainer's copy carries the edit link. `isUpdate` marks the resend after a post-close edit.
async function sendCompletedFormsEmail({ session: sessionRow, additionalTrainings, attendees, rosterPath, ahaRosterPath, trainerProfileEmail, isUpdate = false }) {
  const session = await withDayTrainers(sessionRow);
  const formAttachments = [];
  for (const training of [null, ...additionalTrainings]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const certFiles = await listCertificateFiles(session, training);
      if (!certFiles.length) continue; // eslint-disable-line no-continue
      const label = training ? training.training_type_label : session.training_type_label;
      // eslint-disable-next-line no-await-in-loop
      const zip = await certificateZipBuffer(certFiles);
      formAttachments.push({
        filename: `${certificateZipName(session, label)}.zip`,
        content: zip.toString('base64'),
        summary: {
          kind: 'ZIP',
          label: additionalTrainings.length ? `Attendee Certificates – ${stripTrainingIdPrefix(label)}` : 'Attendee Certificates',
          detail: `${certFiles.length} certificate PDF${certFiles.length === 1 ? '' : 's'} in one ZIP file`,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Certificate ZIP for email failed for session ${session.session_id}:`, err);
    }
  }
  const attachFile = (filePath, filename, summary) => {
    if (!filePath) return;
    try {
      formAttachments.push({ filename, content: fs.readFileSync(filePath).toString('base64'), summary });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Could not attach ${filename} to forms email for session ${session.session_id}:`, err);
    }
  };
  attachFile(rosterPath, buildRosterFilename(session, 'pdf'), { kind: 'PDF', label: 'Sign-In Roster', detail: 'Signed attendance roster for the session' });
  attachFile(ahaRosterPath, buildRosterFilename(session, 'pdf').replace('.pdf', '_AHA-Roster.pdf'), { kind: 'PDF', label: 'AHA Course Roster', detail: 'Completed AHA Heartsaver Course Roster' });
  if (!formAttachments.length) return;

  const normalize = (e) => (e ? e.trim().toLowerCase() : null);
  // A multi-day session's other day trainers get the completed forms too - by the email they
  // signed off with, or their trainer profile's. Co-trainers (migration 074) too. Anyone teaching
  // with no email anywhere is flagged to the office instead of silently skipped.
  const dayTrainerEmails = [];
  const unreachable = [];
  const addTrainer = async (name, profileId, signedEmail = null) => {
    const profileEmail = profileId ? (await dbGet('SELECT email FROM employees WHERE employee_id = ?', [profileId]))?.email : null;
    dayTrainerEmails.push(signedEmail, profileEmail);
    if (!normalize(signedEmail) && !normalize(profileEmail) && name) unreachable.push(name);
  };
  for (const d of session.session_days || []) {
    // eslint-disable-next-line no-await-in-loop
    await addTrainer(d.signed_trainer_name || d.assigned_trainer_name, d.signed_trainer_employee_id || d.assigned_trainer_employee_id, d.signed_trainer_email);
  }
  for (const co of await getCoTrainers(session.session_id)) {
    // eslint-disable-next-line no-await-in-loop
    await addTrainer(co.trainer_name, co.trainer_employee_id);
  }
  // Each app user's Training Emails on/off is set on Manage Users (routes/users.js, Keeley's
  // request, 2026-09-30); email_settings (migration 067) holds the trainer on/off and any extra
  // addresses, which stay at their defaults (trainers on, no extras) - no screen edits them.
  const settings = await dbGet('SELECT * FROM email_settings WHERE id = ?', ['default']);
  const toTrainers = settings ? Boolean(settings.session_emails_to_trainers) : true;
  const trainerRecipients = new Set(toTrainers ? [session.trainer_email, trainerProfileEmail, ...dayTrainerEmails].map(normalize).filter(Boolean) : []);
  const appUsers = await dbAll('SELECT email FROM app_users WHERE email IS NOT NULL AND gets_session_emails = 1', []);
  const extra = String(settings?.session_emails_extra || '').split(/[,;\s]+/).map(normalize).filter(Boolean);
  const recipients = [...new Set([...trainerRecipients, ...appUsers.map((u) => normalize(u.email)), ...extra].filter(Boolean))];

  const editUrl = sessionEditUrl(await ensureEditToken(session.session_id));
  const trainingLabels = [session.training_type_label, ...additionalTrainings.map((t) => t.training_type_label)];
  const attachmentsSummary = formAttachments.map((a) => a.summary);
  const attachments = formAttachments.map(({ filename, content }) => ({ filename, content }));
  const logoUrl = `${publicBaseUrl()}/email-logo.png`;
  const feedback = await sessionFeedbackSummary(session.session_id);
  // Multi Training Day: how many of the trainings each attendee was certified for.
  let emailAttendees = attendees;
  if (isMultiTrainingDay(session)) {
    const certs = attendees.length
      ? await dbAll('SELECT attendee_id FROM attendee_certificates WHERE attendee_id = ANY(?) AND certificate_path IS NOT NULL', [attendees.map((a) => a.attendee_id)])
      : [];
    const total = 1 + additionalTrainings.length;
    emailAttendees = attendees.map((a) => ({
      ...a,
      trainings_total: total,
      trainings_certified: (a.certificate_path ? 1 : 0) + certs.filter((c) => c.attendee_id === a.attendee_id).length,
    }));
  }

  // One at a time (lib/email.js also paces them) - sent all at once, the email service refused
  // some and a trainer never got theirs (Keeley's report, 2026-10-05).
  const failed = [];
  for (const to of recipients) {
    const recipientIsTrainer = trainerRecipients.has(to);
    const email = buildSessionCompleteEmail({
      session, trainingLabels, attendees: emailAttendees, attachmentsSummary, recipientIsTrainer, logoUrl, isUpdate, feedback,
      editUrl: recipientIsTrainer ? editUrl : null,
    });
    try {
      await sendEmail({ to, ...email, attachments }); // eslint-disable-line no-await-in-loop
    } catch (err) {
      failed.push(to);
      // eslint-disable-next-line no-console
      console.error(`Completed forms email to ${to} failed for session ${session.session_id}:`, err.message);
    }
  }

  // Tell the office (bell only) when a trainer couldn't be emailed, so someone can forward it.
  const problems = [
    ...(toTrainers ? [...new Set(unreachable)].map((name) => `${name} has no email on file`) : []),
    ...failed.map((to) => `the email to ${to} didn't go through`),
  ];
  if (problems.length) {
    try {
      const { notifyAllUsers } = require('./notifications'); // eslint-disable-line global-require
      await notifyAllUsers({
        type: 'session_email_problem',
        title: `${stripTrainingIdPrefix(session.training_type_label)} · ${session.client_name}: completed forms not delivered to everyone`,
        body: `${problems.join('; ')}. Download the roster and certificates from the session page to send them.`,
        link_path: `/sessions/${session.session_id}`,
        email: false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Could not flag the email problem for session ${session.session_id}:`, err.message);
    }
  }
}

module.exports = {
  AHA_ROSTER_TRAINING_ID,
  AHA_FIELDS,
  ahaColumnsFromBody,
  getSessionWithClient,
  ensureEditToken,
  sessionEditUrl,
  regenerateRosters,
  sendCompletedFormsEmail,
};
