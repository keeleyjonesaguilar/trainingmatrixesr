// The class summary email to the trainer(s) (Keeley's request, 2026-10-12): when a training session
// is created, every trainer on it (lead, each day's trainer on a multi-day course, co-trainers) is
// emailed the class details and what they need to run it, with the Sign-In and Feedback QR codes
// attached. Trainers added on a later edit get it then; the session page can re-send it to everyone
// after a change. Toolbox talks don't get one. Trainers with no email on file are flagged on the bell.
//
// Reworked 2026-10-14 (Keeley's list): sections in her order - training type, trainer(s), language,
// logistics, the PowerPoint (WeTransfer), instructions, outline - with the PowerPoint link up top
// too, and no sign-in page link (trainers scan the same QR code the attendees scan to close out).
// On a multi-day course each day's trainer only sees their own day(s): its date, outline and
// PowerPoint - never another day's. Also sent at 5:00 AM on the day they teach
// (lib/trainerSummaryScheduler.js).
const { dbGet, dbAll } = require('../db');
const { sendEmail } = require('./email');
const { notifyAllUsers } = require('./notifications');
const { qrPngBuffer, feedbackQrPngBuffer } = require('./qr');
const { sessionTrainers, getSessionDays, getCoTrainers } = require('./sessionDays');
const { trainingParts, isMultiTrainingDay } = require('./sessionParts');
const { stripTrainingIdPrefix } = require('./certificateFilename');
const { labeledQrPng } = require('./qrLabel');
const { nameKey } = require('./names');

const GREEN = '#026754';
const GOLD = '#c49b0d';
const MUTED = '#62676f';
const BORDER = '#e2e5e9';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const SIGN_IN_COLOR = GREEN;
const FEEDBACK_COLOR = '#8a6c05'; // gold ink - the theme gold is too light for text
const LANGUAGES = { english: 'English', spanish: 'Spanish', both: 'English and Spanish' };
const CLOSE_BUTTON_LABEL = "I'm the trainer – Review and Close Session";

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function multiline(value) {
  return esc(value).replace(/\t/g, ' ').replace(/\n/g, '<br>');
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

function longDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function sessionDatesText(session) {
  const dates = parseJson(session.day_dates);
  if (dates && dates.length > 1) return `${longDate(dates[0])} – ${longDate(dates[dates.length - 1])} (${dates.length} days)`;
  return longDate(session.session_date);
}

function link(url) {
  return `<a href="${esc(url)}" style="color:${GREEN};word-break:break-all;">${esc(url)}</a>`;
}

function rowsTable(rows) {
  return rows.filter(Boolean).map(([k, v]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 12px 6px 0;width:130px;vertical-align:top;">${esc(k)}</td>
                <td style="${FONT}font-size:14px;color:#1a1d21;padding:6px 0;">${v}</td>
              </tr>`).join('');
}

function panelShell(heading, inner) {
  return `<tr><td style="padding:10px 26px 4px;">
        <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${GREEN};margin-bottom:6px;">${esc(heading)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-left:4px solid ${GREEN};border-radius:8px;">
          <tr><td style="padding:10px 16px;">${inner}</td></tr>
        </table>
      </td></tr>`;
}

function panel(heading, rows) {
  return panelShell(heading, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsTable(rows)}</table>`);
}

function listPanel(heading, items) {
  return panelShell(heading, `<ul style="margin:4px 0;padding-left:20px;${FONT}font-size:14px;line-height:1.55;color:#1a1d21;">${items.filter(Boolean).map((i) => `<li style="margin:4px 0;">${i}</li>`).join('')}</ul>`);
}

function textPanel(heading, html) {
  return panelShell(heading, `<div style="${FONT}font-size:14px;line-height:1.55;color:#1a1d21;">${html}</div>`);
}

function emailShell({ kicker, title, intro, panels }) {
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
      ${panels.join('')}
      <tr><td style="padding:16px 26px 22px;${FONT}font-size:12px;color:${MUTED};">
        <div style="border-top:1px solid ${BORDER};padding-top:12px;">Questions about this class? Contact the ESR office.<br><strong style="color:${GREEN};">Evolution Safety Resources</strong> · Sent automatically by the ESR Safety Training Matrix. This mailbox isn't monitored.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

// "Sign-In QR Code - Fall Protection - 2026-10-14.png" - what it is first, so the two attachments
// can't be mixed up even when the email client cuts the name short.
function qrFilename(session, kind) {
  const training = stripTrainingIdPrefix(session.training_type_label).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${kind} - ${training} - ${session.session_date}.png`;
}

// Who a trainer is, for matching them to a day: their profile id and their name.
function trainerKeys(employeeId, name) {
  return [employeeId, name ? `name:${nameKey(name)}` : null].filter(Boolean);
}

// Every trainer on the session with the email on their profile (the lead falls back to the email
// they last closed out with). `missing` = trainers with no email anywhere. `keys` lets a recipient
// be matched to the days they teach (one address can belong to more than one listed trainer).
async function trainerRecipients(session, { onlyEmployeeIds = null, onlyKeys = null } = {}) {
  const out = new Map();
  const missing = [];
  for (const t of await sessionTrainers(session)) {
    if (onlyEmployeeIds && !onlyEmployeeIds.includes(t.employee_id)) continue; // eslint-disable-line no-continue
    const keys = trainerKeys(t.employee_id, t.name);
    if (onlyKeys && !keys.some((k) => onlyKeys.has(k))) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const profile = t.employee_id ? await dbGet('SELECT email, portal_invited_at FROM employees WHERE employee_id = ?', [t.employee_id]) : null;
    const isLead = t.employee_id ? t.employee_id === session.trainer_employee_id : t.name === session.trainer_name;
    const email = String(profile?.email || (isLead ? session.trainer_email : '') || '').trim().toLowerCase();
    if (!email) missing.push(t.name);
    else if (out.has(email)) out.get(email).keys.push(...keys);
    else out.set(email, { email, name: t.name, portal: Boolean(profile?.portal_invited_at), keys });
  }
  return { recipients: [...out.values()], missing };
}

async function summaryDetails(sessionId) {
  const session = await dbGet(
    'SELECT ts.*, c.client_name FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?',
    [sessionId]
  );
  if (!session) return null;
  const extras = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const trainings = extras.length || isMultiTrainingDay(session)
    ? (await trainingParts(session, extras)).map((p) => ({ label: stripTrainingIdPrefix(p.label), duration: p.duration }))
    : [{ label: stripTrainingIdPrefix(session.training_type_label), duration: session.duration }];
  const coTrainers = await getCoTrainers(sessionId);
  return {
    session,
    trainings,
    trainers: await sessionTrainers(session),
    coTrainers,
    coKeys: new Set(coTrainers.flatMap((t) => trainerKeys(t.trainer_employee_id, t.trainer_name))),
    days: await getSessionDays(session),
    dayOutlines: parseJson(session.day_outlines) || [],
    dayLinks: parseJson(session.day_wetransfer_links) || [],
  };
}

function dayKeys(day) {
  return trainerKeys(day.assigned_trainer_employee_id, day.assigned_trainer_name);
}

// The days of a multi-day course this recipient should see: the days they're assigned to teach.
// Co-trainers teach every day, and a lead trainer who isn't assigned a day sees the whole course.
// `d.onlyDay` (the 5 AM email) narrows it to that one day.
function visibleDays(d, r) {
  if (!d.days.length) return [];
  let days = d.days;
  if (!r.keys.some((k) => d.coKeys.has(k))) {
    const mine = d.days.filter((day) => dayKeys(day).some((k) => r.keys.includes(k)));
    if (mine.length) days = mine;
  }
  return d.onlyDay ? days.filter((day) => day.day_number === d.onlyDay) : days;
}

// The PowerPoint link(s) this recipient gets: their days' own links, else the session's one link.
function powerpointLinks(d, days) {
  const own = days.map((day) => ({ day, url: d.dayLinks[day.day_number - 1] })).filter((x) => x.url);
  if (own.length) return own;
  return d.session.wetransfer_link ? [{ day: null, url: d.session.wetransfer_link }] : [];
}

function buildEmail(d, r, { added = false, morning = false } = {}) {
  const s = d.session;
  const title = d.trainings.map((t) => t.label).join(' + ');
  const first = String(r.name || '').trim().split(/\s+/)[0];
  const multiDay = d.days.length > 0;
  const days = visibleDays(d, r);
  const wholeCourse = days.length === d.days.length;
  const showDayLabels = multiDay && days.length > 1;
  const dayLabel = (day) => `Day ${day.day_number} of ${s.total_days}`;
  const finalDay = multiDay ? days.some((day) => day.day_number === s.total_days) : true;
  const links = powerpointLinks(d, days);

  const dateText = !multiDay
    ? longDate(s.session_date)
    : wholeCourse && days.length > 1 ? sessionDatesText(s)
      : days.map((day) => `${dayLabel(day)} – ${longDate(day.date) || 'date to be set'}`).join(', ');

  // 1. Training type, trainer(s), language.
  const trainerText = multiDay
    ? [
      ...days.map((day) => `${showDayLabels || !wholeCourse ? `Day ${day.day_number}: ` : ''}${esc(day.assigned_trainer_name || '')}`),
      d.coTrainers.length ? `With: ${esc(d.coTrainers.map((t) => t.trainer_name).join(', '))}` : null,
    ].filter(Boolean).join('<br>')
    : esc(d.trainers.map((t) => t.name).join(', '));
  const shownTrainers = multiDay ? new Set([...days.map((day) => nameKey(day.assigned_trainer_name || '')), ...d.coTrainers.map((t) => nameKey(t.trainer_name))]).size : d.trainers.length;
  const classRows = [
    [d.trainings.length > 1 ? 'Training Types' : 'Training Type', d.trainings.map((t) => `${esc(t.label)}${d.trainings.length > 1 && t.duration ? ` <span style="color:${MUTED};">· ${esc(t.duration)}</span>` : ''}`).join('<br>')],
    [shownTrainers > 1 ? 'Trainers' : 'Trainer', trainerText],
    ['Language', esc(LANGUAGES[s.language] || 'English')],
  ];

  // 2. Logistics.
  const logisticsRows = [
    ['Client', esc(s.client_name)],
    [multiDay && days.length > 1 ? 'Dates' : 'Date', multiDay && (showDayLabels || !wholeCourse)
      ? days.map((day) => `<strong>Day ${day.day_number}</strong> · ${esc(longDate(day.date) || 'Date to be set')}`).join('<br>')
      : esc(dateText)],
    s.duration ? [d.trainings.length > 1 ? 'Total hours' : 'Hours', `${esc(s.duration)}${multiDay ? ` <span style="color:${MUTED};">· whole course, ${s.total_days} days</span>` : ''}`] : null,
    ['Location', esc(s.location || 'To be confirmed by the office')],
  ];

  // 3. The PowerPoint.
  const powerpointHtml = links.length
    ? links.map((l) => `${l.day && (showDayLabels || !wholeCourse) ? `<strong>Day ${l.day.day_number}:</strong> ` : ''}${link(l.url)}`).join('<br>')
      + `<div style="font-size:12px;color:${MUTED};margin-top:4px;">WeTransfer - download ${links.length > 1 ? 'these' : 'it'} before class. The QR codes are already in the PowerPoint.</div>`
    : null;

  // 4. Instructions - the QR-code note last (Keeley: "disclaimer type of bullet ... at the very end").
  const signoffOnly = multiDay && !finalDay;
  const instructions = [
    `At the start of class, show the <strong style="color:${SIGN_IN_COLOR};">green SIGN-IN</strong> QR code that is at the beginning of the PowerPoint. Attendees scan it with their phone camera to sign in.${multiDay ? ' On a multi-day course they sign in every day - anyone back from an earlier day picks "I was here on an earlier day".' : ''}`,
    `To see who has signed in, or to ${signoffOnly ? 'sign off your day' : 'close out'}, <strong>scan that same SIGN-IN QR code yourself</strong> and tap <strong>"${CLOSE_BUTTON_LABEL}"</strong>${signoffOnly ? ' (on your day it reads "end of Day sign-off")' : ''}. You'll need the trainer PIN.`,
    `At the end of class, show the <strong style="color:${FEEDBACK_COLOR};">gold FEEDBACK</strong> QR code so attendees can rate the class.`,
    signoffOnly
      ? 'Sign off your day only at the END of class, after everyone has signed in - it opens the next day for sign-ins.'
      : 'Close the session at the END of class, after everyone has signed in and given feedback - certificates and the roster are created automatically and emailed to you. Add any notes about the class (any issues?) on the close-out form.',
    r.portal ? `On class day you can also see who has signed in from the ESR Training Portal - sign in at ${link(`${publicBaseUrl()}/portal`)} and click View roster.` : null,
    `<em>The QR codes are also attached to this email as a backup, in case there are any issues with the PowerPoint - the same QR codes are already in the PowerPoint.</em>`,
  ];

  // 5. The outline - only this recipient's days on a multi-day course.
  let outlineHtml = null;
  if (multiDay) {
    const parts = days.map((day) => ({ day, text: d.dayOutlines[day.day_number - 1] })).filter((p) => p.text && p.text.trim());
    if (parts.length) {
      outlineHtml = parts.map((p) => `${showDayLabels || !wholeCourse || parts.length > 1 ? `<div style="font-weight:700;margin-top:6px;">Day ${p.day.day_number}</div>` : ''}${multiline(p.text.trim())}`).join('');
    } else if (s.outline) outlineHtml = multiline(s.outline);
  } else if (s.outline) outlineHtml = multiline(s.outline);

  const whichDays = multiDay && !wholeCourse ? ` (${days.map((day) => `Day ${day.day_number}`).join(' and ')} of ${s.total_days})` : '';
  const lead = morning
    ? `You're teaching this class today${whichDays}. Here's everything you need.`
    : added
      ? `You've been added as a trainer on this class${whichDays}. Here's everything you need.`
      : `You're scheduled to teach this class${whichDays}. Here's everything you need.`;
  const topLink = links.length
    ? `<p style="margin:10px 0 0;"><strong>PowerPoint:</strong> ${links.map((l) => `${l.day && (showDayLabels || !wholeCourse) ? `Day ${l.day.day_number} ` : ''}${link(l.url)}`).join('<br>')}</p>`
    : '';

  const subjectDates = multiDay && !wholeCourse ? days.map((day) => `Day ${day.day_number} – ${longDate(day.date)}`).join(', ') : dateText;
  const subjectLead = morning ? 'Today' : added ? "You've been added to" : 'Your upcoming class';
  return {
    subject: `${subjectLead}: ${title} – ${s.client_name} – ${subjectDates}`,
    html: emailShell({
      kicker: morning ? "Today's Class" : 'Class Summary',
      title,
      intro: `<p style="margin:0;">Hi ${esc(first)},</p><p style="margin:8px 0 0;">${lead}</p>${topLink}`,
      panels: [
        panel('Class details', classRows),
        panel('Logistics', logisticsRows),
        powerpointHtml ? textPanel('PowerPoint', powerpointHtml) : '',
        listPanel('Instructions', instructions),
        outlineHtml ? textPanel('Outline', outlineHtml) : '',
      ],
    }),
  };
}

// Emails the summary. `onlyEmployeeIds` limits it to those trainers (the ones just added on an
// edit). `dayNumber` (multi-day) limits it to that day's trainer and the co-trainers, showing only
// that day - the 5 AM day-of email. Returns who it went to, who has no email, and any that failed.
async function sendTrainerSummary(sessionId, { onlyEmployeeIds = null, added = false, morning = false, dayNumber = null } = {}) {
  const d = await summaryDetails(sessionId);
  if (!d) return { error: 'Session not found.' };
  const s = d.session;
  if (s.session_kind === 'toolbox_talk') return { skipped: 'toolbox_talk', sent_to: [], missing: [], failed: [] };
  if (s.status === 'closed') return { error: 'This session is already closed.' };
  let onlyKeys = null;
  if (dayNumber && d.days.length) {
    const day = d.days[dayNumber - 1];
    if (!day) return { error: `This session has no Day ${dayNumber}.` };
    d.onlyDay = dayNumber;
    onlyKeys = new Set([...dayKeys(day), ...d.coKeys]);
  }
  const { recipients, missing } = await trainerRecipients(s, { onlyEmployeeIds, onlyKeys });
  const attachments = recipients.length ? [
    {
      filename: qrFilename(s, 'Sign-In QR Code'),
      content: labeledQrPng(await qrPngBuffer(s.qr_token), 'signin').toString('base64'),
    },
    {
      filename: qrFilename(s, 'Feedback QR Code'),
      content: labeledQrPng(await feedbackQrPngBuffer(s.qr_token), 'feedback').toString('base64'),
    },
  ] : [];
  const failed = [];
  for (const r of recipients) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: r.email, ...buildEmail(d, r, { added, morning }), attachments });
    } catch (err) {
      failed.push(r.email);
      console.error(`Class summary email to ${r.email} failed:`, err.message); // eslint-disable-line no-console
    }
  }
  if (missing.length) {
    await notifyAllUsers({
      type: 'trainer_summary_missing_email',
      title: `No email for ${missing.join(', ')} - class summary not sent`,
      body: `${d.trainings.map((t) => t.label).join(' + ')} – ${s.client_name} – ${sessionDatesText(s)}. Add an email to their profile, then use "Email Class Summary" on the session.`,
      link_path: `/sessions/${s.session_id}`,
      email: false,
    });
  }
  return {
    sent_to: recipients.filter((r) => !failed.includes(r.email)).map((r) => `${r.name} (${r.email})`),
    missing,
    failed,
  };
}

// For create/edit: never lets an email problem fail the save itself.
async function sendTrainerSummarySafely(sessionId, options) {
  try {
    return await sendTrainerSummary(sessionId, options);
  } catch (err) {
    console.error('Class summary email failed:', err.message); // eslint-disable-line no-console
    return { error: 'The class summary email could not be sent.', sent_to: [], missing: [], failed: [] };
  }
}

module.exports = { sendTrainerSummary, sendTrainerSummarySafely, buildEmail, summaryDetails, trainerRecipients };
