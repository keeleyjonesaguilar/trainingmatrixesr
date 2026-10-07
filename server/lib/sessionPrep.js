// Session prep (migration 076, Keeley's request, 2026-10-07). When a session taught by one of our
// own trainers is created, the prep team (app users with "Prep requests" on - Guy, Jayna) is
// emailed to fill in the class details on the session page: number of students, room layout, AV
// connection, the WeTransfer link and any assistant instructor (added as a co-trainer). Saving
// those emails the reviewers ("Prep review" on - Emily, Keeley), who check the session and send the
// trainer(s) a summary with everything they need. Outside trainers and toolbox talks skip all this.
//   prep_status: NULL (no prep) -> 'info_needed' -> 'ready_to_send' -> 'sent'
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { sendEmail } = require('./email');
const { qrPngBuffer, publicSignInUrl } = require('./qr');
const { sessionTrainers, getCoTrainers, saveCoTrainers, getSessionDays } = require('./sessionDays');
const { trainingParts, isMultiTrainingDay } = require('./sessionParts');
const { stripTrainingIdPrefix, buildQrFilename } = require('./certificateFilename');

const GREEN = '#026754';
const GOLD = '#c49b0d';
const MUTED = '#62676f';
const BORDER = '#e2e5e9';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const WETRANSFER_PATTERN = /^https?:\/\/\S+$/i;

const PREP_LABELS = { info_needed: 'Additional info needed', ready_to_send: 'Ready to send', sent: 'Sent to trainer' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

function longDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function sessionDatesText(session) {
  const dates = session.day_dates ? (typeof session.day_dates === 'string' ? JSON.parse(session.day_dates) : session.day_dates) : null;
  if (dates && dates.length > 1) return `${longDate(dates[0])} – ${longDate(dates[dates.length - 1])} (${dates.length} days)`;
  return longDate(session.session_date);
}

// A trainer's type (migration 077): what's set on their profile, or - not set yet - Internal when
// the profile is under the internal trainers client or Evolution Safety Resources, else External.
const TRAINER_TYPE_SQL = `COALESCE(e.trainer_type, CASE WHEN c.client_id = '${repo.INTERNAL_CLIENT_ID}' OR c.is_internal = 1
  OR LOWER(c.client_name) = 'evolution safety resources' THEN 'internal' ELSE 'external' END)`;

async function trainerType(employeeId) {
  if (!employeeId) return null;
  const row = await dbGet(
    `SELECT ${TRAINER_TYPE_SQL} AS type FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_id = ?`,
    [employeeId]
  );
  return row ? row.type : null;
}

async function isInternalTrainer(employeeId) {
  return (await trainerType(employeeId)) === 'internal';
}

// A training session with at least one of our own trainers (lead, a day's trainer, or co-trainer).
async function needsPrep(session) {
  if (session.session_kind === 'toolbox_talk') return false;
  for (const t of await sessionTrainers(session)) {
    // eslint-disable-next-line no-await-in-loop
    if (await isInternalTrainer(t.employee_id)) return true;
  }
  return false;
}

async function usersWith(flag) {
  return dbAll(`SELECT username, full_name, email FROM app_users WHERE ${flag} = 1 AND email IS NOT NULL AND email <> ''`, []);
}

// The session as the emails and the session page describe it.
async function prepDetails(sessionRow) {
  const session = sessionRow.client_name ? sessionRow
    : await dbGet('SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?', [sessionRow.session_id]);
  const extras = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
  const trainings = extras.length || isMultiTrainingDay(session)
    ? (await trainingParts(session, extras)).map((p) => ({ label: stripTrainingIdPrefix(p.label), duration: p.duration }))
    : [{ label: stripTrainingIdPrefix(session.training_type_label), duration: session.duration }];
  const trainers = await sessionTrainers(session);
  const co = await getCoTrainers(session.session_id);
  return { session, trainings, trainers, coTrainers: co.map((c) => c.trainer_name) };
}

function emailShell({ kicker, title, intro, rows, button, footer }) {
  const rowHtml = rows.filter(Boolean).map(([k, v]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 12px 6px 0;width:140px;vertical-align:top;">${esc(k)}</td>
                <td style="${FONT}font-size:14px;color:#1a1d21;padding:6px 0;">${v}</td>
              </tr>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${BORDER};overflow:hidden;">
      <tr><td style="padding:20px 26px;border-bottom:4px solid ${GOLD};">
        <img src="${publicBaseUrl()}/email-logo.png" alt="Evolution Safety Resources" width="160" style="display:block;width:160px;height:auto;border:0;">
      </td></tr>
      <tr><td style="background:${GREEN};padding:20px 26px;">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">${esc(kicker)}</div>
        <div style="${FONT}font-size:20px;font-weight:700;color:#ffffff;margin-top:6px;">${esc(title)}</div>
      </td></tr>
      <tr><td style="padding:22px 26px 6px;${FONT}font-size:15px;line-height:1.55;color:#1a1d21;">${intro}</td></tr>
      <tr><td style="padding:6px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-left:4px solid ${GREEN};border-radius:8px;">
          <tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table></td></tr>
        </table>
      </td></tr>
      ${button ? `<tr><td style="padding:16px 26px 4px;"><a href="${esc(button.url)}" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">${esc(button.label)}</a></td></tr>` : ''}
      <tr><td style="padding:16px 26px 22px;${FONT}font-size:12px;color:${MUTED};">
        <div style="border-top:1px solid ${BORDER};padding-top:12px;">${footer ? `${footer}<br>` : ''}<strong style="color:${GREEN};">Evolution Safety Resources</strong> · Sent automatically by the ESR Safety Training Matrix. This mailbox isn't monitored.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function trainingsHtml(trainings) {
  return trainings.map((t) => `${esc(t.label)}${t.duration ? ` <span style="color:${MUTED};">· ${esc(t.duration)}</span>` : ''}`).join('<br>');
}

function baseRows(d) {
  const s = d.session;
  return [
    ['Class type', trainingsHtml(d.trainings)],
    ['Client', esc(s.client_name)],
    ['Date', esc(sessionDatesText(s))],
    s.location ? ['Location', esc(s.location)] : null,
    ['Trainer(s)', esc(d.trainers.map((t) => t.name).join(', '))],
  ];
}

function sessionPageUrl(session) {
  return `${publicBaseUrl()}/sessions/${session.session_id}`;
}

async function sendEach(recipients, build) {
  const failed = [];
  for (const r of recipients) {
    try {
      await sendEmail({ to: r.email, ...build(r) }); // eslint-disable-line no-await-in-loop
    } catch (err) {
      failed.push(r.email);
      console.error(`Session prep email to ${r.email} failed:`, err.message); // eslint-disable-line no-console
    }
  }
  return failed;
}

// Right after a session is created (or an internal trainer is put on it): mark it as needing
// prep and email the prep team. Returns true when prep was started.
// `force` starts it even for an outside trainer (the office asking for it on the session page).
async function startPrep(sessionRow, { force = false } = {}) {
  if (sessionRow.prep_status || sessionRow.status === 'closed' || sessionRow.session_kind === 'toolbox_talk') return false;
  if (!force && !(await needsPrep(sessionRow))) return false;
  await dbRun("UPDATE training_sessions SET prep_status = 'info_needed' WHERE session_id = ? AND prep_status IS NULL", [sessionRow.session_id]);
  const d = await prepDetails(sessionRow);
  const label = `${d.trainings.map((t) => t.label).join(' + ')} – ${d.session.client_name}`;
  await sendEach(await usersWith('gets_prep_requests'), (u) => ({
    subject: `Session prep needed: ${label} – ${sessionDatesText(d.session)}`,
    html: emailShell({
      kicker: 'Action Needed',
      title: 'Add the class details for this session',
      intro: `<p style="margin:0;">Hi ${esc((u.full_name || u.username).split(' ')[0])}, a new training session was set up with one of our trainers. Please add the number of students, room layout, AV connection, WeTransfer link, and any assistant instructor on the session page.</p>`,
      rows: [...baseRows(d), d.session.wetransfer_link ? ['WeTransfer', `<a href="${esc(d.session.wetransfer_link)}">${esc(d.session.wetransfer_link)}</a>`] : null],
      button: { label: 'Open the Session', url: `${sessionPageUrl(d.session)}?prep=1` },
    }),
  }));
  return true;
}

// The prep team saves the class details. Required: number of students, room layout, AV
// connection. The assistant instructor(s) become co-trainers. Completing it moves the session to
// 'ready_to_send' and emails the reviewers - also after a change to details already sent, so the
// updated summary gets reviewed and sent again.
async function savePrep(sessionRow, body, actor) {
  const count = Number(body.student_count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) return { error: 'Enter the number of students.' };
  const roomLayout = String(body.room_layout || '').trim();
  if (!roomLayout) return { error: 'Enter the room layout.' };
  const av = String(body.av_connection || '').toLowerCase();
  if (!['yes', 'no'].includes(av)) return { error: 'Choose Yes or No for the AV connection.' };
  const hasLink = Object.prototype.hasOwnProperty.call(body, 'wetransfer_link');
  const link = String(hasLink ? body.wetransfer_link || '' : sessionRow.wetransfer_link || '').trim();
  if (!link) return { error: 'Enter the WeTransfer link.' };
  if (!WETRANSFER_PATTERN.test(link)) return { error: 'The WeTransfer link should start with https://' };

  // Required (Keeley's call, 2026-10-07); left out of the request, the saved link is kept.
  await dbRun(
    `UPDATE training_sessions SET prep_student_count = ?, prep_room_layout = ?, prep_av_connection = ?,
       wetransfer_link = ?, prep_completed_by = ?, prep_completed_at = now_utc_text() WHERE session_id = ?`,
    [count, roomLayout.slice(0, 2000), av, link, actor, sessionRow.session_id]
  );
  if (Array.isArray(body.co_trainer_ids)) await saveCoTrainers(sessionRow, body.co_trainer_ids);

  let notified = false;
  if (sessionRow.prep_status !== 'ready_to_send') {
    await dbRun("UPDATE training_sessions SET prep_status = 'ready_to_send' WHERE session_id = ?", [sessionRow.session_id]);
    const d = await prepDetails({ session_id: sessionRow.session_id });
    const label = `${d.trainings.map((t) => t.label).join(' + ')} – ${d.session.client_name}`;
    await sendEach(await usersWith('gets_prep_review'), (u) => ({
      subject: `Session prep ready for review: ${label} – ${sessionDatesText(d.session)}`,
      html: emailShell({
        kicker: 'Ready for Review',
        title: 'Session details are filled in',
        intro: `<p style="margin:0;">Hi ${esc((u.full_name || u.username).split(' ')[0])}, ${esc(actor)} added the class details for this session. Check that everything is right, then send the summary to the trainer(s) from the session page.</p>`,
        rows: [...baseRows(d), ...prepRows(d.session, d.coTrainers)],
        button: { label: 'Review & Send to Trainer', url: `${sessionPageUrl(d.session)}?prep=1` },
      }),
    }));
    notified = true;
  }
  return { ok: true, notified };
}

function prepRows(s, coTrainers) {
  return [
    ['# of students', esc(s.prep_student_count ?? '—')],
    ['Room layout', esc(s.prep_room_layout || '—').replace(/\n/g, '<br>')],
    ['AV connection', s.prep_av_connection === 'yes' ? 'Yes' : s.prep_av_connection === 'no' ? 'No' : '—'],
    ['WeTransfer', s.wetransfer_link ? `<a href="${esc(s.wetransfer_link)}">${esc(s.wetransfer_link)}</a>` : '—'],
    ['Assistant instructor', esc(coTrainers.length ? coTrainers.join(', ') : 'None')],
  ];
}

// Every trainer on the session with an email: the lead (profile, or the email they last signed off
// with), each day's trainer on a multi-day course, and the co-trainers.
async function trainerRecipients(session) {
  const out = new Map();
  const missing = [];
  const add = (name, email) => {
    const e = String(email || '').trim().toLowerCase();
    if (e) { if (!out.has(e)) out.set(e, { email: e, name }); } else missing.push(name);
  };
  const profileEmail = async (id) => (id ? (await dbGet('SELECT email FROM employees WHERE employee_id = ?', [id]))?.email : null);
  add(session.trainer_name, (await profileEmail(session.trainer_employee_id)) || session.trainer_email);
  for (const d of await getSessionDays(session)) {
    // eslint-disable-next-line no-await-in-loop
    add(d.assigned_trainer_name, await profileEmail(d.assigned_trainer_employee_id));
  }
  for (const c of await getCoTrainers(session.session_id)) {
    // eslint-disable-next-line no-await-in-loop
    add(c.trainer_name, await profileEmail(c.trainer_employee_id));
  }
  const reached = new Set([...out.values()].map((r) => r.name));
  return { recipients: [...out.values()], missing: [...new Set(missing)].filter((n) => n && !reached.has(n)) };
}

// The reviewer sends the trainer(s) everything for the class: details, prep info, the WeTransfer
// link, the sign-in link, and the QR code as an attachment. Can be sent again after a change.
async function sendTrainerSummary(sessionRow, actor) {
  if (!['ready_to_send', 'sent'].includes(sessionRow.prep_status)) {
    return { error: 'The class details need to be filled in before the summary can be sent.' };
  }
  const d = await prepDetails({ session_id: sessionRow.session_id });
  const s = d.session;
  const { recipients, missing } = await trainerRecipients(s);
  if (!recipients.length) return { error: 'None of the trainers on this session has an email address on their profile.' };
  const qr = await qrPngBuffer(s.qr_token);
  const signInUrl = publicSignInUrl(s.qr_token);
  const label = `${d.trainings.map((t) => t.label).join(' + ')} – ${s.client_name}`;
  const failed = await sendEach(recipients, (r) => ({
    subject: `Your upcoming class: ${label} – ${sessionDatesText(s)}`,
    html: emailShell({
      kicker: 'Class Summary',
      title: `${d.trainings.map((t) => t.label).join(' + ')}`,
      intro: `<p style="margin:0;">Hi ${esc(String(r.name || '').split(' ')[0])}, here's everything for your upcoming class. The sign-in QR code is attached - display it at the start of class so attendees can sign in.</p>`,
      rows: [
        ...baseRows(d),
        s.duration ? [d.trainings.length === 1 ? 'Duration' : 'Total duration', esc(s.duration)] : null,
        ...prepRows(s, d.coTrainers),
        ['Sign-in link', `<a href="${esc(signInUrl)}">${esc(signInUrl)}</a>`],
        s.outline ? ['Outline', esc(s.outline).replace(/\n/g, '<br>')] : null,
      ],
      button: s.wetransfer_link ? { label: 'Open the WeTransfer Files', url: s.wetransfer_link } : null,
    }),
    attachments: [{ filename: buildQrFilename(s, 'Sign-In QR'), content: qr.toString('base64') }],
  }));
  const sent = recipients.filter((r) => !failed.includes(r.email));
  if (!sent.length) return { error: 'The summary email could not be sent. Please try again.' };
  await dbRun("UPDATE training_sessions SET prep_status = 'sent', prep_sent_by = ?, prep_sent_at = now_utc_text() WHERE session_id = ?", [actor, s.session_id]);
  return { ok: true, sent_to: sent.map((r) => `${r.name} (${r.email})`), failed, missing };
}

module.exports = {
  PREP_LABELS, TRAINER_TYPE_SQL, needsPrep, startPrep, savePrep, sendTrainerSummary, isInternalTrainer, trainerType, trainerRecipients,
};
