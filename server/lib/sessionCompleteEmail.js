// The "Training Session Completed" email sent on close-out (Keeley's request, 2026-09-22: the
// first version "looks bland and it isn't clear who it is or what it is") - ESR-branded, with a
// session summary, a list of what's attached, and the completed roster. Email clients ignore
// <style> blocks and modern CSS, so this is table-based with every style inline.
const { stripTrainingIdPrefix } = require('./certificateFilename');

const GREEN = '#026754';
const GOLD = '#c49b0d';
const TEXT = '#1a1d21';
const MUTED = '#62676f';
const BORDER = '#e2e5e9';
const BG = '#f6f7f9';
const FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "2026-09-22" -> "September 22, 2026" (anchored to UTC so it can't roll to the adjacent day).
function longDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function sessionDates(session) {
  const days = session.day_dates ? JSON.parse(session.day_dates) : null;
  if (days && days.length > 1) return `${longDate(days[0])} – ${longDate(days[days.length - 1])} (${days.length} days)`;
  return longDate(session.session_date);
}

function attendeeResult(a) {
  if (a.processing_status === 'incomplete_attendance') return { text: 'Incomplete – missed a day', color: '#a15c00', bg: '#fff2df' };
  if (a.certificate_path) return { text: 'Certified', color: '#146c3a', bg: '#e3f6ea' };
  return { text: 'No certificate', color: '#b3261e', bg: '#fde8e8' };
}

/**
 * @param session            closed training_sessions row joined with client_name
 * @param trainingLabels     every training the session covered (primary first)
 * @param attendees          final session_attendees rows
 * @param attachmentsSummary [{ kind: 'ZIP'|'PDF', label, detail }] - what's attached, in display order
 * @param recipientIsTrainer true for the trainer's own copy, false for ESR staff copies
 * @param logoUrl            absolute URL (or data: URI for previews) of the ESR logo
 * @param editUrl            the trainer's "Edit close-out details" link - trainer's copy only
 * @param isUpdate           true for the resend after the trainer edits a closed session
 */
function buildSessionCompleteEmail({ session, trainingLabels, attendees, attachmentsSummary, recipientIsTrainer, logoUrl, editUrl = null, isUpdate = false }) {
  const trainingNames = trainingLabels.map(stripTrainingIdPrefix);
  const title = trainingNames.join(' + ');
  const trainerName = session.trainer_signed_name || session.trainer_name || 'the trainer';
  const firstName = trainerName.split(' ')[0];
  const certified = attendees.filter((a) => attendeeResult(a).text === 'Certified').length;
  const notCertified = attendees.length - certified;

  const subject = `${isUpdate ? 'Training Updated' : 'Training Completed'}: ${title} – ${session.client_name} – ${longDate(session.session_date)}`;

  let intro;
  if (isUpdate) {
    intro = recipientIsTrainer
      ? `Hi ${esc(firstName)}, your changes to this session were saved. The updated paperwork is attached and replaces what was sent before.`
      : `${esc(trainerName)} updated the close-out details for this session. The updated paperwork is attached and replaces what was sent before.`;
  } else {
    intro = recipientIsTrainer
      ? `Hi ${esc(firstName)}, thank you for leading this session. Your completed paperwork is attached to this email for your records.`
      : `${esc(trainerName)} just closed out this session. The completed paperwork is attached to this email.`;
  }

  // Trainer's copy only (Keeley's request, 2026-09-24): lets them fill in details they didn't have
  // at close-out, or remove a duplicate sign-in. Saving there requires the trainer PIN.
  const editBlock = editUrl ? `
        <tr><td style="padding:8px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:10px;">
            <tr><td style="padding:14px 18px;">
              <div style="${FONT}font-size:14px;font-weight:700;color:${TEXT};">Need to change something?</div>
              <div style="${FONT}font-size:13px;line-height:1.5;color:${MUTED};margin:4px 0 12px;">Fill in a missing address or other details, or remove a duplicate sign-in. You'll need your trainer PIN to save.</div>
              <a href="${esc(editUrl)}" style="display:inline-block;background:${GREEN};color:#ffffff;${FONT}font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px;">Edit Close-Out Details</a>
            </td></tr>
          </table>
        </td></tr>
` : '';

  const summaryRows = [
    ['Training', esc(title)],
    ['Client', esc(session.client_name)],
    ['Date', esc(sessionDates(session))],
    ['Trainer', esc(trainerName)],
    ...(session.location ? [['Location', esc(session.location)]] : []),
    ['Attendees', `${attendees.length} total &nbsp;·&nbsp; <span style="color:#146c3a;font-weight:600;">${certified} certified</span>${notCertified ? ` &nbsp;·&nbsp; <span style="color:#a15c00;font-weight:600;">${notCertified} not certified</span>` : ''}`],
  ].map(([k, v]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 0;width:110px;vertical-align:top;">${k}</td>
                <td style="${FONT}font-size:14px;color:${TEXT};padding:6px 0;">${v}</td>
              </tr>`).join('');

  const attachmentRows = attachmentsSummary.map((a) => `
              <tr>
                <td style="padding:6px 0;width:34px;vertical-align:top;">
                  <div style="width:26px;height:26px;border-radius:6px;background:${GREEN};color:#fff;${FONT}font-size:11px;font-weight:700;line-height:26px;text-align:center;">${esc(a.kind)}</div>
                </td>
                <td style="${FONT}font-size:14px;color:${TEXT};padding:6px 0;"><strong>${esc(a.label)}</strong><br><span style="font-size:12px;color:${MUTED};">${esc(a.detail)}</span></td>
              </tr>`).join('');

  const rosterRows = attendees.map((a, i) => {
    const r = attendeeResult(a);
    return `
              <tr style="background:${i % 2 ? '#fafbfc' : '#ffffff'};">
                <td style="${FONT}font-size:13px;color:${MUTED};padding:9px 10px;border-top:1px solid ${BORDER};">${i + 1}</td>
                <td style="${FONT}font-size:13px;color:${TEXT};padding:9px 10px;border-top:1px solid ${BORDER};font-weight:600;">${esc(a.trainee_name)}</td>
                <td style="${FONT}font-size:13px;color:${MUTED};padding:9px 10px;border-top:1px solid ${BORDER};">${esc(a.trainee_job_title || '—')}</td>
                <td style="${FONT}font-size:12px;padding:9px 10px;border-top:1px solid ${BORDER};white-space:nowrap;"><span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${r.bg};color:${r.color};font-weight:600;">${r.text}</span></td>
              </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">

        <tr><td style="padding:22px 28px;border-bottom:4px solid ${GOLD};background:#ffffff;">
          <img src="${esc(logoUrl)}" alt="Evolution Safety Resources" width="170" style="display:block;width:170px;max-width:60%;height:auto;border:0;">
        </td></tr>

        <tr><td style="background:${GREEN};padding:24px 28px;">
          <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">${isUpdate ? 'Training Session Updated' : 'Training Session Completed'}</div>
          <div style="${FONT}font-size:24px;font-weight:700;color:#ffffff;margin-top:6px;line-height:1.25;">${esc(title)}</div>
          <div style="${FONT}font-size:14px;color:#cfe5df;margin-top:6px;">${esc(session.client_name)} &nbsp;·&nbsp; ${esc(sessionDates(session))}</div>
        </td></tr>

        <tr><td style="padding:24px 28px 8px;">
          <p style="${FONT}font-size:15px;line-height:1.55;color:${TEXT};margin:0;">${intro}</p>
        </td></tr>

        <tr><td style="padding:12px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};border-radius:10px;border-left:4px solid ${GREEN};">
            <tr><td style="padding:14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${summaryRows}
              </table>
            </td></tr>
          </table>
        </td></tr>
${editBlock}
        <tr><td style="padding:16px 28px 4px;">
          <div style="${FONT}font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Attached to this email</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${attachmentRows}
          </table>
        </td></tr>

        <tr><td style="padding:18px 28px 8px;">
          <div style="${FONT}font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Completed Roster</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;overflow:hidden;">
            <tr style="background:${GREEN};">
              <th align="left" style="${FONT}font-size:11px;color:#ffffff;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;">#</th>
              <th align="left" style="${FONT}font-size:11px;color:#ffffff;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;">Name</th>
              <th align="left" style="${FONT}font-size:11px;color:#ffffff;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;">Job Title</th>
              <th align="left" style="${FONT}font-size:11px;color:#ffffff;text-transform:uppercase;letter-spacing:.05em;padding:9px 10px;">Result</th>
            </tr>${rosterRows || `
            <tr><td colspan="4" style="${FONT}font-size:13px;color:${MUTED};padding:12px 10px;">No attendees signed in.</td></tr>`}
          </table>
        </td></tr>

        <tr><td style="padding:22px 28px 26px;">
          <div style="border-top:1px solid ${BORDER};padding-top:16px;${FONT}font-size:12px;line-height:1.6;color:${MUTED};">
            <strong style="color:${GREEN};">Evolution Safety Resources</strong><br>
            Sent automatically by the ESR Safety Training Matrix when this session was ${isUpdate ? 'updated' : 'closed out'}.
            This mailbox isn't monitored – please contact your ESR representative with any questions.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

module.exports = { buildSessionCompleteEmail };
