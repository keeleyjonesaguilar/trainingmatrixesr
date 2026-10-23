// Public interest sign-up for open-enrollment classes (Keeley's request, 2026-10-23). The office
// opens a normal training session to the public (server/routes/publicSignupAdmin.js); anyone can
// then leave their details at /register/<token> (server/routes/publicSignup.js), naming each person
// who's interested, and the office follows up. Interest only for now - no price or payment.
// Each sign-up emails the office and the person who signed up. Attendees still sign in each day
// with the session's usual QR code.
const { dbAll } = require('../db');
const { sendEmail } = require('./email');
const { notifyAllUsers } = require('./notifications');
const { stripTrainingIdPrefix } = require('./certificateFilename');
const { firstLast, nameKey } = require('./names');

// Who hears about each new sign-up - all three on one email (Keeley, 2026-10-23: "keeley emily
// and jeff"). PUBLIC_SIGNUP_ALERT_EMAILS (comma-separated) replaces the list without a code change.
const ALERT_EMAILS = (process.env.PUBLIC_SIGNUP_ALERT_EMAILS || 'keeley@esr-safety.com, emily@esr-safety.com, jeff@esr-safety.com')
  .split(',').map((e) => e.trim()).filter(Boolean);
// Where the person's replies to their confirmation email go - the sending address isn't read.
const REPLY_TO = process.env.PUBLIC_SIGNUP_REPLY_TO || 'keeley@esr-safety.com';
const MAX_PEOPLE = 20;

const GREEN = '#026754';
const GOLD = '#c49b0d';
const MUTED = '#62676f';
const BORDER = '#e2e5e9';
const BG = '#f6f7f9';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function publicSignupUrl(token) {
  return `${publicBaseUrl()}/register/${token}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Every class day as YYYY-MM-DD - a multi-day course's day_dates, otherwise its one date.
function classDays(session) {
  let days = session.day_dates;
  if (typeof days === 'string') {
    try { days = JSON.parse(days); } catch { days = null; }
  }
  const list = Array.isArray(days) ? days.filter(Boolean) : [];
  return list.length ? list : [session.session_date].filter(Boolean);
}

function longDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function trainingName(session) {
  return stripTrainingIdPrefix(session.training_type_label);
}

async function peopleCount(sessionId) {
  const rows = await dbAll('SELECT COALESCE(SUM(seats), 0) AS people FROM public_registrations WHERE session_id = ?', [sessionId]);
  return Number(rows[0]?.people || 0);
}

// Every sign-up on a session, newest first, each with its people's names - and whether each has
// signed in to the class yet (same first/last name match the sign-in page uses).
async function listRegistrations(sessionId) {
  const regs = await dbAll('SELECT * FROM public_registrations WHERE session_id = ? ORDER BY created_at DESC', [sessionId]);
  if (!regs.length) return [];
  const attendees = await dbAll(
    `SELECT pra.* FROM public_registration_attendees pra
     JOIN public_registrations pr ON pr.registration_id = pra.registration_id
     WHERE pr.session_id = ? ORDER BY pra.seat_number`,
    [sessionId]
  );
  const signedIn = new Set(
    (await dbAll('SELECT trainee_name FROM session_attendees WHERE session_id = ?', [sessionId])).map((a) => nameKey(a.trainee_name))
  );
  return regs.map((r) => ({
    ...r,
    attendees: attendees
      .filter((a) => a.registration_id === r.registration_id)
      .map((a) => ({ ...a, signed_in: signedIn.has(nameKey(firstLast(a.first_name, a.last_name))) })),
  }));
}

function detailRows(rows) {
  return rows.filter(([, v]) => v).map(([label, value]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 14px 6px 0;width:110px;vertical-align:top;">${esc(label)}</td>
                <td style="${FONT}font-size:14px;color:#1a1d21;padding:6px 0;">${value}</td>
              </tr>`).join('');
}

function frame({ subject, kicker, title, body }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
        <tr><td style="padding:20px 26px;border-bottom:4px solid ${GOLD};background:#ffffff;">
          <img src="${esc(`${publicBaseUrl()}/email-logo.png`)}" alt="Evolution Safety Resources" width="160" style="display:block;width:160px;max-width:60%;height:auto;border:0;">
        </td></tr>
        <tr><td style="background:${GREEN};padding:22px 26px;">
          <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">${esc(kicker)}</div>
          <div style="${FONT}font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;line-height:1.25;">${esc(title)}</div>
        </td></tr>
        <tr><td style="padding:22px 26px;${FONT}font-size:15px;line-height:1.55;color:#1a1d21;">
${body}
        </td></tr>
        <tr><td style="padding:0 26px 22px;${FONT}font-size:12px;color:${MUTED};">
          <div style="border-top:1px solid ${BORDER};padding-top:14px;"><strong style="color:${GREEN};">Evolution Safety Resources</strong><br>Sent automatically by the ESR Training Portal.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px;margin:4px 0 8px;">${esc(label)}</a>`;
}

function nameList(attendees) {
  return attendees.map((a) => esc(firstLast(a.first_name, a.last_name))).join('<br>');
}

function classRows(session) {
  return [
    ['Class', esc(trainingName(session))],
    ['Dates', classDays(session).map((d) => esc(longDate(d))).join('<br>')],
    ['Hours', esc(session.public_class_hours)],
    ['Location', esc(session.location)],
  ];
}

function buildConfirmationEmail(session, registration, attendees) {
  const subject = `Thanks for your interest: ${trainingName(session)}`;
  const contact = firstLast(registration.contact_first_name, registration.contact_last_name);
  const body = `
          <p style="margin:0 0 14px;">Hi ${esc(registration.contact_first_name)}, thanks for your interest in this class. We've received your information and will be in touch with next steps.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="background:${BG};border-radius:10px;border-left:4px solid ${GREEN};width:100%;">
            <tr><td style="padding:12px 16px;"><table role="presentation" cellpadding="0" cellspacing="0">
              ${detailRows([
                ...classRows(session),
                [registration.seats > 1 ? 'People' : 'Person', nameList(attendees)],
              ])}
            </table></td></tr>
          </table>
          ${session.public_details ? `<p style="margin:16px 0 0;white-space:pre-line;">${esc(session.public_details)}</p>` : ''}
          <p style="margin:14px 0 0;color:${MUTED};font-size:13px;">Sent for ${esc(contact)}${registration.company ? `, ${esc(registration.company)}` : ''}. Questions? Just reply to this email.</p>`;
  return { subject, html: frame({ subject, kicker: 'Interest Received', title: trainingName(session), body }) };
}

function buildOfficeEmail(session, registration, attendees, totalPeople) {
  const contact = firstLast(registration.contact_first_name, registration.contact_last_name);
  const subject = `New interest: ${trainingName(session)} – ${contact}${registration.seats > 1 ? ` (${registration.seats} people)` : ''}`;
  const body = `
          <p style="margin:0 0 14px;"><strong>${esc(contact)}</strong> is interested in this class for ${registration.seats} ${registration.seats === 1 ? 'person' : 'people'}.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="${FONT}font-size:14px;margin:0 0 16px;">
            ${detailRows([
              ['Name', esc(contact)],
              ['Email', esc(registration.contact_email)],
              ['Phone', esc(registration.contact_phone)],
              ['Company', esc(registration.company)],
              [registration.seats > 1 ? 'People' : 'Person', nameList(attendees)],
              ['Total interest', `${totalPeople} ${totalPeople === 1 ? 'person' : 'people'} so far`],
            ])}
          </table>
          ${button(`${publicBaseUrl()}/sessions/${session.session_id}`, 'Open the Class')}`;
  return { subject, html: frame({ subject, kicker: 'New Interest Sign-Up', title: trainingName(session), body }) };
}

// Bell + office email + confirmation to the person. Never throws - the sign-up is already saved,
// and a failed email mustn't turn it into an error on the public page.
async function announceRegistration(session, registration, attendees) {
  const contact = firstLast(registration.contact_first_name, registration.contact_last_name);
  try {
    await notifyAllUsers({
      type: 'public_signup',
      title: `${trainingName(session)}: ${contact} is interested${registration.seats > 1 ? ` (${registration.seats} people)` : ''}`,
      body: registration.company ? `${registration.company} · ${registration.contact_email}` : registration.contact_email,
      link_path: `/sessions/${session.session_id}`,
      email: false,
    });
  } catch (err) {
    console.error(`Public sign-up bell alert failed for ${registration.registration_id}:`, err.message);
  }
  const totalPeople = await peopleCount(session.session_id);
  const sends = [
    sendEmail({ to: ALERT_EMAILS, ...buildOfficeEmail(session, registration, attendees, totalPeople) }),
    sendEmail({ to: registration.contact_email, replyTo: REPLY_TO, fromName: 'Evolution Safety Resources', ...buildConfirmationEmail(session, registration, attendees) }),
  ];
  const results = await Promise.allSettled(sends);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error(`Public sign-up email failed for ${registration.registration_id}:`, r.reason?.message));
}

module.exports = {
  MAX_PEOPLE,
  publicSignupUrl,
  classDays,
  trainingName,
  peopleCount,
  listRegistrations,
  announceRegistration,
  buildConfirmationEmail,
  buildOfficeEmail,
};
