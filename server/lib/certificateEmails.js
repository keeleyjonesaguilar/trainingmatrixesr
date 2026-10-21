// Emailing a closed session's certificates by hand (Keeley's request, 2026-10-14: sending them one
// at a time "is taking a lot of time out of my day"). Two buttons on the session page, never
// automatic:
//   - Email Certificates to Employees: each attendee gets only their own certificate(s), one email
//     each, to the address chosen in the send window (prefilled from the sign-in email or their
//     employee profile).
//   - Email Certificates to Company: the company's contact(s) get the same certificate ZIP(s) as
//     the "Download Certificates" button, plus the sign-in roster if ticked, in one email.
// And from an employee's profile (same day): any of their training records' certificates in one
// email to them - Email Certificates on the Completed Trainings table.
// Replies go to whoever pressed Send (the sending address isn't monitored). Routes live in
// routes/trainingSessions.js and routes/employees.js.
const fs = require('fs');
const { dbGet, dbAll, dbRun } = require('../db');
const { sendEmail } = require('./email');
const { listCertificateFiles, certificateZipName, certificateZipBuffer } = require('./certificateZip');
const { buildCertificateFilename, buildRosterFilename, stripTrainingIdPrefix } = require('./certificateFilename');
const { parseName, displayFirstLast } = require('./names');
const { buildRecordCertificate, computeFilenameForRecord } = require('./recordCertificates');
const { clearSendToClientAlert } = require('./sendToClientAlerts');
const {
  esc, longDate, sessionDates, GREEN, GOLD, TEXT, MUTED, BORDER, BG, FONT,
} = require('./sessionCompleteEmail');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The "From" name on both certificate emails (Keeley's choice, 2026-10-14) - same sending address.
const FROM_NAME = 'ESR: Completed Training';
// Resend refuses an email over 40 MB, attachments counted after base64 (which adds a third).
const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

// "a@x.com; b@y.com, c@z.com" (or a list) -> ['a@x.com', 'b@y.com', 'c@z.com'], deduped.
function splitEmails(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/);
  return [...new Set(list.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

async function getSession(sessionId) {
  return dbGet(
    `SELECT ts.*, c.client_name, c.certificate_emails AS client_certificate_emails
     FROM training_sessions ts JOIN clients c ON c.client_id = ts.client_id WHERE ts.session_id = ?`,
    [sessionId]
  );
}

// Who pressed Send - named in the email, and where replies go.
async function senderFor(user) {
  const row = user ? await dbGet('SELECT full_name, username, email FROM app_users WHERE user_id = ?', [user.user_id]) : null;
  return { name: row?.full_name || row?.username || null, email: row?.email || null };
}

// Every certificate one attendee has on this session - the session's own training, then each
// additional training they were certified for - as { path, name, label }.
async function attendeeCertificateFiles(session, attendee, additionalTrainings) {
  const files = [];
  if (attendee.certificate_path && fs.existsSync(attendee.certificate_path)) {
    files.push({ path: attendee.certificate_path, name: buildCertificateFilename(session, attendee), label: session.training_type_label });
  }
  if (additionalTrainings.length) {
    const certs = await dbAll('SELECT * FROM attendee_certificates WHERE attendee_id = ? AND certificate_path IS NOT NULL', [attendee.attendee_id]);
    for (const t of additionalTrainings) {
      const cert = certs.find((c) => c.session_additional_training_id === t.id);
      if (cert && fs.existsSync(cert.certificate_path)) {
        const trainingSession = { ...session, training_type_label: t.training_type_label };
        files.push({ path: cert.certificate_path, name: buildCertificateFilename(trainingSession, attendee), label: t.training_type_label });
      }
    }
  }
  return files;
}

// True when the session has a certificate on record for this attendee but the PDF isn't on this
// server's disk - e.g. on a local copy, where the database is the live one but the files live on
// the live server - so the window can say so instead of "No certificate".
async function certificateFileMissing(attendee) {
  if (attendee.certificate_path && !fs.existsSync(attendee.certificate_path)) return true;
  const certs = await dbAll('SELECT certificate_path FROM attendee_certificates WHERE attendee_id = ? AND certificate_path IS NOT NULL', [attendee.attendee_id]);
  return certs.some((c) => !fs.existsSync(c.certificate_path));
}

// Shared frame for both emails - same header, banner and footer as the close-out email.
function frame({ subject, kicker, title, subtitle, body, sender }) {
  const signoff = sender.email
    ? `Sent by ${esc(sender.name || 'Evolution Safety Resources')}. Reply to this email with any questions.`
    : 'Please contact your ESR representative with any questions.';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">

        <tr><td style="padding:22px 28px;border-bottom:4px solid ${GOLD};background:#ffffff;">
          <img src="${esc(`${publicBaseUrl()}/email-logo.png`)}" alt="Evolution Safety Resources" width="170" style="display:block;width:170px;max-width:60%;height:auto;border:0;">
        </td></tr>

        <tr><td style="background:${GREEN};padding:24px 28px;">
          <div style="${FONT}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${GOLD};">${esc(kicker)}</div>
          <div style="${FONT}font-size:24px;font-weight:700;color:#ffffff;margin-top:6px;line-height:1.25;">${esc(title)}</div>
          <div style="${FONT}font-size:14px;color:#cfe5df;margin-top:6px;">${subtitle}</div>
        </td></tr>
${body}
        <tr><td style="padding:22px 28px 26px;">
          <div style="border-top:1px solid ${BORDER};padding-top:16px;${FONT}font-size:12px;line-height:1.6;color:${MUTED};">
            <strong style="color:${GREEN};">Evolution Safety Resources</strong><br>
            ${signoff}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function paragraph(html) {
  return `
        <tr><td style="padding:24px 28px 8px;">
          <p style="${FONT}font-size:15px;line-height:1.55;color:${TEXT};margin:0;">${html}</p>
        </td></tr>
`;
}

function summaryBox(rows) {
  const trs = rows.map(([k, v]) => `
              <tr>
                <td style="${FONT}font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;padding:6px 0;width:110px;vertical-align:top;">${k}</td>
                <td style="${FONT}font-size:14px;color:${TEXT};padding:6px 0;">${v}</td>
              </tr>`).join('');
  return `
        <tr><td style="padding:12px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};border-radius:10px;border-left:4px solid ${GREEN};">
            <tr><td style="padding:14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}
              </table>
            </td></tr>
          </table>
        </td></tr>
`;
}

function attachedList(items) {
  const rows = items.map((a) => `
              <tr>
                <td style="padding:6px 0;width:34px;vertical-align:top;">
                  <div style="width:26px;height:26px;border-radius:6px;background:${GREEN};color:#fff;${FONT}font-size:11px;font-weight:700;line-height:26px;text-align:center;">${esc(a.kind)}</div>
                </td>
                <td style="${FONT}font-size:14px;color:${TEXT};padding:6px 0;"><strong>${esc(a.label)}</strong><br><span style="font-size:12px;color:${MUTED};">${esc(a.detail)}</span></td>
              </tr>`).join('');
  return `
        <tr><td style="padding:16px 28px 4px;">
          <div style="${FONT}font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Attached to this email</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td></tr>
`;
}

function trainerNames(session) {
  return session.trainer_signed_name || session.trainer_name || '';
}

function buildAttendeeEmail({ session, attendee, files, sender }) {
  const names = files.map((f) => stripTrainingIdPrefix(f.label));
  const title = names.join(' + ');
  const subject = `Your Training Certificate${files.length === 1 ? '' : 's'}: ${title} – ${longDate(session.session_date)}`;
  const first = parseName(attendee.trainee_name).first;
  const greeting = first ? `Hi ${esc(first)}` : 'Hello';
  const intro = `${greeting}, congratulations on completing <strong>${esc(title)}</strong> with Evolution Safety Resources. `
    + `Your certificate${files.length === 1 ? ' is' : 's are'} attached to this email - please keep a copy for your records.`;
  const rows = [
    ['Name', esc(attendee.trainee_name)],
    ['Training', esc(title)],
    ['Company', esc(session.client_name)],
    ['Date', esc(sessionDates(session))],
    ...(trainerNames(session) ? [['Trainer', esc(trainerNames(session))]] : []),
  ];
  const attached = files.map((f) => ({ kind: 'PDF', label: `Certificate – ${stripTrainingIdPrefix(f.label)}`, detail: f.name }));
  const html = frame({
    subject,
    kicker: `Certificate${files.length === 1 ? '' : 's'} of Completion`,
    title,
    subtitle: `${esc(session.client_name)} &nbsp;·&nbsp; ${esc(sessionDates(session))}`,
    body: paragraph(intro) + summaryBox(rows) + attachedList(attached),
    sender,
  });
  return { subject, html };
}

function buildCompanyEmail({ session, trainingLabels, attendees, attachedSummary, sender }) {
  const title = trainingLabels.map(stripTrainingIdPrefix).join(' + ');
  const subject = `Training Certificates: ${title} – ${session.client_name} – ${longDate(session.session_date)}`;
  const intro = `Hello, the certificates for your team's <strong>${esc(title)}</strong> training on ${esc(sessionDates(session))} are attached to this email.`;
  const rows = [
    ['Training', esc(title)],
    ['Company', esc(session.client_name)],
    ['Date', esc(sessionDates(session))],
    ...(trainerNames(session) ? [['Trainer', esc(trainerNames(session))]] : []),
    ...(session.location ? [['Location', esc(session.location)]] : []),
    ['Certified', `${attendees.length} employee${attendees.length === 1 ? '' : 's'}`],
  ];
  const nameRows = attendees.map((a, i) => `
              <tr style="background:${i % 2 ? '#fafbfc' : '#ffffff'};">
                <td style="${FONT}font-size:13px;color:${MUTED};padding:8px 10px;border-top:1px solid ${BORDER};width:28px;">${i + 1}</td>
                <td style="${FONT}font-size:13px;color:${TEXT};padding:8px 10px;border-top:1px solid ${BORDER};font-weight:600;">${esc(a.trainee_name)}</td>
                <td style="${FONT}font-size:13px;color:${MUTED};padding:8px 10px;border-top:1px solid ${BORDER};">${esc(a.trainee_job_title || '')}</td>
              </tr>`).join('');
  const roster = attendees.length ? `
        <tr><td style="padding:18px 28px 8px;">
          <div style="${FONT}font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Employees Certified</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;border-collapse:separate;overflow:hidden;">${nameRows}
          </table>
        </td></tr>
` : '';
  const html = frame({
    subject,
    kicker: 'Training Certificates',
    title,
    subtitle: `${esc(session.client_name)} &nbsp;·&nbsp; ${esc(sessionDates(session))}`,
    body: paragraph(intro) + summaryBox(rows) + attachedList(attachedSummary) + roster,
    sender,
  });
  return { subject, html };
}

// What the "Email Certificates to Employees" window lists: every attendee, how many certificates
// they have, and the address to prefill (sign-in email first, then their employee profile's).
async function attendeeEmailOptions(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const attendees = await dbAll('SELECT * FROM session_attendees WHERE session_id = ? ORDER BY trainee_name', [sessionId]);
  const employeeIds = attendees.map((a) => a.employee_id).filter(Boolean);
  const employees = employeeIds.length ? await dbAll('SELECT employee_id, email FROM employees WHERE employee_id = ANY(?)', [employeeIds]) : [];
  const out = [];
  for (const a of attendees) {
    const files = await attendeeCertificateFiles(session, a, additionalTrainings); // eslint-disable-line no-await-in-loop
    const profileEmail = employees.find((e) => e.employee_id === a.employee_id)?.email || null;
    out.push({
      attendee_id: a.attendee_id,
      trainee_name: a.trainee_name,
      employee_id: a.employee_id,
      email: a.trainee_email || profileEmail || '',
      certificates: files.map((f) => stripTrainingIdPrefix(f.label)),
      certificate_file_missing: files.length ? false : await certificateFileMissing(a), // eslint-disable-line no-await-in-loop
      certificate_emailed_at: a.certificate_emailed_at,
      certificate_emailed_to: a.certificate_emailed_to,
    });
  }
  return out;
}

// recipients: [{ attendee_id, email }]. One email per person with only their own certificate(s).
// An address typed in the window is kept: on the attendee's row when they had none, and on their
// employee profile when it had none (never overwrites an address already on file).
async function sendAttendeeCertificates(sessionId, recipients, user) {
  const session = await getSession(sessionId);
  if (!session) return { error: 'Session not found.', status: 404 };
  if (session.status !== 'closed') return { error: 'Close the session first - certificates are made at close-out.', status: 400 };
  const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const sender = await senderFor(user);
  const sent = [];
  const skipped = [];
  const failed = [];
  for (const r of recipients || []) {
    // eslint-disable-next-line no-await-in-loop
    const attendee = await dbGet('SELECT * FROM session_attendees WHERE attendee_id = ? AND session_id = ?', [r.attendee_id, sessionId]);
    if (!attendee) continue; // eslint-disable-line no-continue
    const email = String(r.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      skipped.push({ name: attendee.trainee_name, reason: email ? `"${email}" isn't a valid email address` : 'no email address' });
      continue; // eslint-disable-line no-continue
    }
    const files = await attendeeCertificateFiles(session, attendee, additionalTrainings); // eslint-disable-line no-await-in-loop
    if (!files.length) {
      // eslint-disable-next-line no-await-in-loop
      const missing = await certificateFileMissing(attendee);
      skipped.push({ name: attendee.trainee_name, reason: missing ? 'certificate file not found on this server' : 'no certificate on file' });
      continue; // eslint-disable-line no-continue
    }
    try {
      const attachments = files.map((f) => ({ filename: f.name, content: fs.readFileSync(f.path).toString('base64') }));
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: email, ...buildAttendeeEmail({ session, attendee, files, sender }), attachments, replyTo: sender.email || undefined, fromName: FROM_NAME });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Certificate email to ${email} failed for attendee ${attendee.attendee_id}:`, err.message);
      failed.push({ name: attendee.trainee_name, email });
      continue; // eslint-disable-line no-continue
    }
    const now = new Date().toISOString();
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      'UPDATE session_attendees SET certificate_emailed_at = ?, certificate_emailed_to = ?, trainee_email = COALESCE(NULLIF(trainee_email, \'\'), ?) WHERE attendee_id = ?',
      [now, email, email, attendee.attendee_id]
    );
    if (attendee.employee_id) {
      // eslint-disable-next-line no-await-in-loop
      await dbRun('UPDATE employees SET email = ? WHERE employee_id = ? AND (email IS NULL OR email = \'\')', [email, attendee.employee_id]);
    }
    sent.push({ name: attendee.trainee_name, email });
  }
  if (sent.length) await dbRun('UPDATE training_sessions SET sent_to_trainees = 1 WHERE session_id = ?', [sessionId]);
  return { session, sent, skipped, failed };
}

// The company copy: a certificate ZIP per training (same as the download buttons), plus the
// sign-in roster (and AHA roster) when `includeRoster`. One email to every address together, so
// the company's contacts can see who else got it. Ticks "Sent to Client" on the session.
async function sendCompanyCertificates(sessionId, { emails, includeRoster = true, saveAsDefault = false }, user) {
  const session = await getSession(sessionId);
  if (!session) return { error: 'Session not found.', status: 404 };
  if (session.status !== 'closed') return { error: 'Close the session first - certificates are made at close-out.', status: 400 };
  const to = splitEmails(emails);
  if (!to.length) return { error: 'Enter at least one email address for the company.', status: 400 };
  const bad = to.filter((e) => !EMAIL_PATTERN.test(e));
  if (bad.length) return { error: `${bad.join(', ')} ${bad.length === 1 ? "isn't a valid email address" : "aren't valid email addresses"}.`, status: 400 };

  const additionalTrainings = await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [sessionId]);
  const attachments = [];
  const attachedSummary = [];
  for (const training of [null, ...additionalTrainings]) {
    const certFiles = await listCertificateFiles(session, training); // eslint-disable-line no-await-in-loop
    if (!certFiles.length) continue; // eslint-disable-line no-continue
    const label = training ? training.training_type_label : session.training_type_label;
    const zip = await certificateZipBuffer(certFiles); // eslint-disable-line no-await-in-loop
    attachments.push({ filename: `${certificateZipName(session, label)}.zip`, content: zip.toString('base64'), bytes: zip.length });
    attachedSummary.push({
      kind: 'ZIP',
      label: additionalTrainings.length ? `Certificates – ${stripTrainingIdPrefix(label)}` : 'Certificates',
      detail: `${certFiles.length} certificate PDF${certFiles.length === 1 ? '' : 's'} in one ZIP file`,
    });
  }
  if (!attachments.length) {
    const onRecord = await dbGet(
      `SELECT 1 FROM session_attendees sa LEFT JOIN attendee_certificates ac ON ac.attendee_id = sa.attendee_id
       WHERE sa.session_id = ? AND (sa.certificate_path IS NOT NULL OR ac.certificate_path IS NOT NULL) LIMIT 1`,
      [sessionId]
    );
    return {
      error: onRecord
        ? "The certificate files aren't on this server (they're on the live site), so they can't be attached here."
        : 'There are no certificates on file for this session to send.',
      status: 400,
    };
  }

  if (includeRoster) {
    const addFile = (filePath, filename, summary) => {
      if (!filePath || !fs.existsSync(filePath)) return;
      const buf = fs.readFileSync(filePath);
      attachments.push({ filename, content: buf.toString('base64'), bytes: buf.length });
      attachedSummary.push(summary);
    };
    addFile(session.roster_pdf_path, buildRosterFilename(session, 'pdf'), { kind: 'PDF', label: 'Sign-In Roster', detail: 'Signed attendance roster for the session' });
    addFile(session.hs_roster_pdf_path, buildRosterFilename(session, 'pdf').replace('.pdf', '_AHA-Roster.pdf'), { kind: 'PDF', label: 'AHA Course Roster', detail: 'Completed AHA Heartsaver Course Roster' });
  }
  const totalBytes = attachments.reduce((sum, a) => sum + a.bytes, 0);
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    return {
      error: `These files are too big to email together (${Math.round(totalBytes / 1024 / 1024)} MB). Download the certificates and send them with WeTransfer instead.`,
      status: 400,
    };
  }

  const certified = await dbAll(
    `SELECT DISTINCT sa.attendee_id, sa.trainee_name, sa.trainee_job_title FROM session_attendees sa
     LEFT JOIN attendee_certificates ac ON ac.attendee_id = sa.attendee_id AND ac.certificate_path IS NOT NULL
     WHERE sa.session_id = ? AND (sa.certificate_path IS NOT NULL OR ac.id IS NOT NULL)
     ORDER BY sa.trainee_name`,
    [sessionId]
  );
  const sender = await senderFor(user);
  const trainingLabels = [session.training_type_label, ...additionalTrainings.map((t) => t.training_type_label)];
  const email = buildCompanyEmail({ session, trainingLabels, attendees: certified, attachedSummary, sender });
  await sendEmail({
    to,
    ...email,
    attachments: attachments.map(({ filename, content }) => ({ filename, content })),
    replyTo: sender.email || undefined,
    fromName: FROM_NAME,
  });

  await dbRun(
    'UPDATE training_sessions SET sent_to_client = 1, certificates_emailed_to_client_at = ?, certificates_emailed_to_client = ? WHERE session_id = ?',
    [new Date().toISOString(), to.join(', '), sessionId]
  );
  await clearSendToClientAlert(sessionId);
  if (saveAsDefault) await dbRun('UPDATE clients SET certificate_emails = ? WHERE client_id = ?', [to.join(', '), session.client_id]);
  return { session, sent_to: to, certificates: certified.length, attachments: attachments.map((a) => a.filename) };
}

// One training record's certificate as an attachment - the same file the profile's View link
// opens: a saved one (uploaded by hand, or from a sign-in session), otherwise the auto-generated
// one built on the spot (lib/recordCertificates.js). { missing: true } when the record points to a
// file that isn't on this server's disk.
async function recordCertificateAttachment(record) {
  if (record.certificate_path && fs.existsSync(record.certificate_path)) {
    const filename = record.certificate_auto_generated
      ? (await computeFilenameForRecord(record)) || record.certificate_filename || 'certificate.pdf'
      : record.certificate_filename || 'certificate.pdf';
    return { filename, content: fs.readFileSync(record.certificate_path) };
  }
  if (record.certificate_auto_generated) {
    const pdf = await buildRecordCertificate(record);
    if (pdf) return { filename: (await computeFilenameForRecord(record)) || record.certificate_filename || 'certificate.pdf', content: pdf };
  }
  return record.certificate_path ? { missing: true } : null;
}

function buildEmployeeCertificatesEmail({ employee, clientName, items, sender }) {
  const one = items.length === 1;
  const title = one ? items[0].training : `${items.length} Training Certificates`;
  const subject = one
    ? `Your Training Certificate: ${items[0].training} – ${longDate(items[0].date)}`
    : `Your Training Certificates (${items.length}) – Evolution Safety Resources`;
  const first = employee.first_name || parseName(employee.full_name).first;
  const intro = `${first ? `Hi ${esc(first)}` : 'Hello'}, ${one ? 'your training certificate is' : 'your training certificates are'} attached to this email - please keep a copy for your records.`;
  const rows = [
    ['Name', esc(displayFirstLast(employee))],
    ...(clientName ? [['Company', esc(clientName)]] : []),
    ...(one ? [['Training', esc(items[0].training)], ['Completed', esc(longDate(items[0].date))]] : [['Certificates', String(items.length)]]),
  ];
  const attached = items.map((i) => ({ kind: /\.pdf$/i.test(i.filename) ? 'PDF' : 'IMG', label: `Certificate – ${i.training}`, detail: `Completed ${longDate(i.date)}` }));
  const html = frame({
    subject,
    kicker: `Certificate${one ? '' : 's'} of Completion`,
    title,
    subtitle: esc(clientName || 'Evolution Safety Resources'),
    body: paragraph(intro) + summaryBox(rows) + attachedList(attached),
    sender,
  });
  return { subject, html };
}

// recordIds: which of the employee's (active) training records to send. `email` is saved to their
// profile when it has none, or when `saveToProfile` (the address was changed in the window).
async function sendEmployeeCertificates(employeeId, { recordIds, email: rawEmail, saveToProfile = false }, user) {
  const employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [employeeId]);
  if (!employee) return { error: 'Employee not found.', status: 404 };
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return { error: email ? `"${email}" isn't a valid email address.` : 'Enter an email address to send to.', status: 400 };
  const ids = [...new Set(Array.isArray(recordIds) ? recordIds : [])];
  if (!ids.length) return { error: 'Choose at least one certificate to send.', status: 400 };
  const records = await dbAll(
    `SELECT r.*, mt.training_name AS master_training_name FROM employee_training_records r
     JOIN master_trainings mt ON mt.training_id = r.training_id
     WHERE r.employee_id = ? AND r.record_id = ANY(?) AND r.is_inactive = 0
     ORDER BY r.completion_date DESC`,
    [employeeId, ids]
  );
  const attachments = [];
  const items = [];
  const skipped = [];
  for (const r of records) {
    const training = stripTrainingIdPrefix(r.original_client_training_name || r.master_training_name);
    const file = await recordCertificateAttachment(r); // eslint-disable-line no-await-in-loop
    if (!file || file.missing) {
      skipped.push({ training, reason: file?.missing ? 'certificate file not found on this server' : 'no certificate on file' });
      continue; // eslint-disable-line no-continue
    }
    attachments.push({ filename: file.filename, content: file.content.toString('base64'), bytes: file.content.length });
    items.push({ record_id: r.record_id, training, date: r.completion_date, filename: file.filename });
  }
  if (!attachments.length) {
    return { error: `Nothing to send - ${skipped.map((x) => `${x.training}: ${x.reason}`).join('; ') || 'no certificates found'}.`, status: 400 };
  }
  const totalBytes = attachments.reduce((sum, a) => sum + a.bytes, 0);
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    return { error: `These certificates are too big to email together (${Math.round(totalBytes / 1024 / 1024)} MB). Choose fewer and send them in two emails.`, status: 400 };
  }

  const client = await dbGet('SELECT client_name, is_internal FROM clients WHERE client_id = ?', [employee.client_id]);
  const sender = await senderFor(user);
  await sendEmail({
    to: email,
    ...buildEmployeeCertificatesEmail({ employee, clientName: client && !client.is_internal ? client.client_name : null, items, sender }),
    attachments: attachments.map(({ filename, content }) => ({ filename, content })),
    replyTo: sender.email || undefined,
    fromName: FROM_NAME,
  });

  const now = new Date().toISOString();
  await dbRun('UPDATE employee_training_records SET certificate_emailed_at = ?, certificate_emailed_to = ? WHERE record_id = ANY(?)', [now, email, items.map((i) => i.record_id)]);
  const profileUpdated = !employee.email || (saveToProfile && employee.email !== email);
  if (profileUpdated) await dbRun('UPDATE employees SET email = ? WHERE employee_id = ?', [email, employeeId]);
  return { employee, sent_to: email, sent: items.map((i) => i.training), skipped, profile_updated: profileUpdated };
}

module.exports = {
  splitEmails, EMAIL_PATTERN, attendeeEmailOptions, sendAttendeeCertificates, sendCompanyCertificates,
  sendEmployeeCertificates, buildAttendeeEmail, buildCompanyEmail, buildEmployeeCertificatesEmail,
};
