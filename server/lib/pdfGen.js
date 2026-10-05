// Certificate-of-completion + roster PDF generation for Training Sign-In sessions. Both live
// on the same persistent disk as the rest of the app's data (server/db.js's DATA_DIR), under
// their own subfolders (certificates/sign-in-sessions/<session>/, rosters/) so they never
// collide with manually-uploaded certificates (DATA_DIR/certificates/<recordId>-<ts>.ext).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { stripTrainingIdPrefix } = require('./certificateFilename');
const { EASTERN_TZ, parseTimestamp } = require('./dates');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
// The actual approved letterhead (Keeley's request, 2026-09-16 - after two hand-drawn attempts
// at recreating the background graphic didn't match, she supplied this exported PNG directly).
// Everything static (logo, address, chevron graphic, headings, footer labels/lines) is baked
// into this image; the code below only draws the 4 dynamic fields on top of it.
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'Training Certificate Template.png');
const ESR_GREEN = '#1B5E42';

// Simulates the template's small-caps display font (a tall initial capital, smaller capitals
// for the rest of each word) using the built-in Times-Roman font, since PDFKit can't apply an
// OpenType small-caps feature and no matching font file was supplied.
//
// Which characters get the tall size (Keeley's report, 2026-09-22: "OSHA 10" printed as
// "Osha 1₀ (construction)"): the first letter of each word, any letter already capitalized in
// the source text (so acronyms like OSHA/CPR/AED stay full-height), and every digit (lining
// figures - a number never mixes sizes). Punctuation before a word's first letter, like the "(" in
// "(Construction)", takes the tall size too so it frames the capital instead of stealing its place.
function smallCapsRuns(word, bigSize, smallSize) {
  const runs = [];
  let seenLetter = false;
  for (const ch of word) {
    const isLetter = /\p{L}/u.test(ch);
    const isDigit = /\d/.test(ch);
    let big;
    if (isDigit) big = true;
    else if (isLetter) {
      big = !seenLetter || (ch === ch.toUpperCase() && ch !== ch.toLowerCase());
      seenLetter = true;
    } else big = !seenLetter;
    const size = big ? bigSize : smallSize;
    const last = runs[runs.length - 1];
    if (last && last.size === size) last.text += ch.toUpperCase();
    else runs.push({ text: ch.toUpperCase(), size });
  }
  return runs;
}

function drawSmallCapsLine(doc, text, { x, width, baselineY, bigSize, smallSize, color, font = 'Times-Roman' }) {
  doc.font(font).fillColor(color);
  const words = text.split(' ').filter(Boolean);
  doc.fontSize(smallSize);
  const spaceWidth = doc.widthOfString(' ');
  const measured = words.map((w) => smallCapsRuns(w, bigSize, smallSize).map((r) => {
    doc.fontSize(r.size);
    return { ...r, width: doc.widthOfString(r.text) };
  }));
  const totalWidth = measured.reduce((sum, runs) => sum + runs.reduce((s, r) => s + r.width, 0), 0) + spaceWidth * (words.length - 1);

  let cursorX = x + (width - totalWidth) / 2;
  for (const runs of measured) {
    for (const r of runs) {
      doc.font(font).fontSize(r.size).text(r.text, cursorX, baselineY - r.size * 0.72, { lineBreak: false });
      cursorX += r.width;
    }
    cursorX += spaceWidth;
  }
}

// Wraps `text` into lines that each fit within `width` at smallSize (a reasonable estimate given
// the actual line also has some bigger initial-capital letters, which only makes lines a little
// tighter - fine for the short training titles this renders), then draws each line centered,
// stacked downward from `startY`.
function drawWrappedSmallCaps(doc, text, { x, width, startY, lineGap, bigSize, smallSize, color }) {
  doc.font('Times-Roman').fontSize(smallSize);
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let current = [];
  for (const word of words) {
    const candidate = [...current, word].join(' ').toUpperCase();
    if (current.length > 0 && doc.widthOfString(candidate) > width) {
      lines.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) lines.push(current.join(' '));

  lines.forEach((line, i) => {
    drawSmallCapsLine(doc, line, { x, width, baselineY: startY + i * lineGap, bigSize, smallSize, color });
  });
}

// PDFKit's built-in fonts (Helvetica, Times-Roman) only cover the Windows-1252 character set, and
// anything else scrambles the rest of the line - a TAB pasted in with a Word bullet list turned a
// roster's outline into symbols (Keeley's report, 2026-10-01: "•<tab>Hand Signals" printed as
// "•”† æB 6–væ Ç0"). Every piece of typed text goes through this before it's drawn: tabs become
// spaces, other control characters go, Word's symbol-font bullets and a few common look-alikes
// become characters the font has, and anything else the font can't draw is dropped.
const WIN_ANSI_EXTRAS = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const LOOKALIKES = {
  '\uF0B7': '•', '\uF0A7': '•', '\uF076': '•', '\uF0D8': '•', '\uF0FC': '•', '\u25CF': '•', '\u25AA': '•', '\u25A0': '•',
  '\u25E6': '•', '\u2023': '•', '\u2043': '•', '\u2219': '•', '\u00B7': '·', '\u2192': '->', '\u2190': '<-',
  '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ',
};
function pdfSafeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/[^\n]/gu, (c) => {
      if (LOOKALIKES[c] !== undefined) return LOOKALIKES[c];
      const code = c.codePointAt(0);
      return (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRAS.has(c) ? c : '';
    })
    .replace(/ {2,}/g, ' ')
    .replace(/ +\n/g, '\n');
}

function b64ToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  const base64 = match ? match[2] : dataUrl;
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

// EASTERN_TZ (Keeley's request, 2026-09-17): the render container's own clock is UTC, not the
// business's Eastern time, so any *timestamp* (has a real time-of-day, e.g. signed_at/closed_at)
// needs an explicit timeZone or it prints hours off from when it actually happened. A plain
// session_date ("YYYY-MM-DD" with no time) doesn't need this - it's anchored to UTC midnight
// below specifically so formatting it can never roll it to the adjacent calendar day.
function formatDate(d) {
  if (!d) return '';
  const dt = d.length === 10 ? new Date(`${d}T00:00:00Z`) : parseTimestamp(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: d.length === 10 ? 'UTC' : EASTERN_TZ,
  });
}

function formatDateTime(d) {
  if (!d) return '—';
  const dt = parseTimestamp(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleString('en-US', { timeZone: EASTERN_TZ });
}

// One certificate of completion per attendee - the ESR letterhead template the president
// approved (Keeley's request, 2026-09-16, blank PNG export supplied after two hand-drawn
// attempts didn't match) is the actual background image; only the 4 dynamic fields (trainee
// name, training title, training date, trainer name) are drawn on top of it, positioned to land
// in the blanks the template already lays out. The trainee's own signature isn't repeated here
// since their name is already the certificate's subject - it's shown instead in the app's
// Completed Trainings table for each employee.
function generateCertificate(session, attendee, outputPath) {
  let filePath = outputPath;
  if (!filePath) {
    const dir = path.join(DATA_DIR, 'certificates', 'sign-in-sessions', session.session_id);
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${attendee.attendee_id}.pdf`);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  drawCertificate(doc, session, attendee);
  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// The same certificate built in memory and never saved (Keeley's report, 2026-10-01: ~8,000 saved
// copies of imported/hand-entered records' certificates filled the live server's 1 GB disk). Those
// certificates carry no signatures, so they're rebuilt from the record each time one is downloaded.
function generateCertificateBuffer(session, attendee) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  drawCertificate(doc, session, attendee);
  doc.end();
  return done;
}

function drawCertificate(doc, session, attendee) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.image(TEMPLATE_PATH, 0, 0, { width: pageWidth, height: pageHeight });

  // Text region the template reserves for "CERTIFICATE OF TRAINING" / "Proudly presented to :" /
  // "For successfully..." - name and training title are centered within this same column.
  const contentLeft = pageWidth * 0.365;
  const contentWidth = pageWidth * 0.95 - contentLeft;

  drawSmallCapsLine(doc, pdfSafeText(attendee.trainee_name), {
    x: contentLeft,
    width: contentWidth,
    baselineY: pageHeight * 0.565,
    bigSize: 32,
    smallSize: 22,
    color: '#1A1A1A',
  });

  // Catalog code ("TRN-060 - ") dropped from the printed title - it's an internal ID, not part
  // of the training's name.
  drawWrappedSmallCaps(doc, pdfSafeText(stripTrainingIdPrefix(session.training_type_label)), {
    x: contentLeft,
    width: contentWidth,
    startY: pageHeight * 0.715,
    lineGap: pageHeight * 0.072,
    bigSize: 28,
    smallSize: 19,
    color: '#1A1A1A',
  });

  // The two sign-off values sit just above the template's own gold lines/labels.
  const footerValueY = pageHeight * 0.855;
  doc
    .fillColor(ESR_GREEN)
    .font('Helvetica')
    .fontSize(13)
    .text(formatDate(session.session_date), pageWidth * 0.365, footerValueY, { width: pageWidth * 0.565 - pageWidth * 0.365, align: 'center' });
  // Every trainer's name goes on the certificate (Keeley's call, 2026-10-01) - with two or three
  // trainers the text shrinks until it fits the line instead of wrapping into the label below.
  const trainerText = pdfSafeText(session.certificate_trainer_name || session.trainer_signed_name || session.trainer_name || '');
  const trainerWidth = pageWidth * 0.866 - pageWidth * 0.665;
  let trainerSize = 13;
  doc.font('Helvetica');
  while (trainerSize > 7 && doc.fontSize(trainerSize).widthOfString(trainerText) > trainerWidth) trainerSize -= 0.5;
  doc
    .fillColor(ESR_GREEN)
    .font('Helvetica')
    .fontSize(trainerSize)
    .text(trainerText, pageWidth * 0.665, footerValueY + (13 - trainerSize) * 0.6, { width: trainerWidth, align: 'center', lineBreak: trainerSize > 7 ? false : true });
}

// One roster PDF per session listing every attendee + both signatures.
function generateRosterPdf(session, attendees) {
  const dir = path.join(DATA_DIR, 'rosters');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${session.session_id}.pdf`);

  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(18).font('Helvetica-Bold').text(session.session_kind === 'toolbox_talk' ? 'Toolbox Talk Sign-In Roster' : 'Training Sign-In Roster');
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica');
  doc.text(pdfSafeText(`Client: ${session.client_name}`));
  const parts = session.training_parts || null;
  if (parts) {
    // Multi Training Day (Keeley's request, 2026-10-05): each training and its own duration.
    doc.text('Multi Training Day:');
    parts.forEach((p) => doc.text(pdfSafeText(`   ${p.number}. ${p.label}${p.duration ? ` - ${p.duration}` : ''}`)));
  } else {
    doc.text(pdfSafeText(`Training: ${session.training_type_label}`));
  }
  const trainerNames = session.all_trainer_names || session.trainer_signed_name || session.trainer_name;
  doc.text(pdfSafeText(`Trainer${session.session_days?.length || String(trainerNames || '').includes(',') ? '(s)' : ''}: ${trainerNames}`));
  doc.text(`Date: ${formatDate(session.session_date)}`);
  // Duration on the printed roster (Keeley's report, 2026-10-05: it was missing).
  if (!parts && session.duration) doc.text(pdfSafeText(`Duration: ${session.duration}`));
  if (session.outline) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Outline / Topics Covered:');
    doc.font('Helvetica').text(pdfSafeText(session.outline));
  }
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text(`Attendees (${attendees.length})`);
  doc.moveDown(0.3);

  const SIG_W = 160;
  const SIG_H = 40;

  attendees.forEach((a, i) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    const rowLeft = doc.x;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(pdfSafeText(`${i + 1}. ${a.trainee_name}`));
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(`Phone: ${pdfSafeText(a.trainee_phone) || '—'}    Email: ${pdfSafeText(a.trainee_email) || '—'}    Signed: ${formatDateTime(a.signed_at)}`);
    if (parts) {
      parts.forEach((p) => {
        const checkin = (a.part_checkins || []).find((c) => c.day_number === p.number);
        let how = checkin ? `Checked in ${formatDateTime(checkin.signed_at)}` : 'Not checked in';
        if (checkin?.marked_by) how = /^Trainer:/.test(checkin.marked_by) ? `Added by the trainer (${checkin.marked_by.replace(/^Trainer:\s*/, '')})` : 'Marked present by office';
        doc.text(pdfSafeText(`   ${checkin ? '[X]' : '[  ]'} ${p.label}: ${how}`));
      });
    }
    const imageTop = doc.y + 2;
    const sig = b64ToBuffer(a.signature);
    let bottom = imageTop;
    if (sig) {
      try {
        doc.image(sig, rowLeft, imageTop, { width: SIG_W, height: SIG_H, fit: [SIG_W, SIG_H] });
        bottom = imageTop + SIG_H;
      } catch {
        bottom = imageTop;
      }
    }
    doc.fillColor('#111111');
    // Explicitly place the cursor below the signature image (image() at fixed
    // coordinates does NOT advance doc.y on its own — relying on moveDown()
    // here previously caused the next row to overlap the signature above it).
    doc.x = rowLeft;
    doc.y = bottom + 14;
  });

  // Multi-day session: each day's trainer and sign-off (server/lib/sessionDays.js), before the
  // final close-out sign-off below.
  if (session.session_days?.length) {
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text('Daily Trainer Sign-Offs');
    session.session_days.forEach((d) => {
      if (doc.y > doc.page.height - 110) doc.addPage();
      const left = doc.x;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111')
        .text(pdfSafeText(`Day ${d.day_number}${d.date ? ` - ${formatDate(d.date)}` : ''}: ${d.signed_trainer_name || d.assigned_trainer_name || '—'}`));
      doc.font('Helvetica').fontSize(10).fillColor('#333333')
        .text(d.signed_at ? `Signed off: ${formatDateTime(d.signed_at)}` : 'Not signed off');
      const top = doc.y + 2;
      const sig = b64ToBuffer(d.signature);
      let bottom = top;
      if (sig) {
        try {
          doc.image(sig, left, top, { width: 160, height: 36, fit: [160, 36] });
          bottom = top + 36;
        } catch {
          /* ignore */
        }
      }
      doc.x = left;
      doc.y = bottom + 8;
    });
  }

  // Trainer sign-off
  if (doc.y > doc.page.height - 180) doc.addPage();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(session.session_days?.length ? 'Final Close-Out' : 'Trainer Sign-Off');
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  doc.text(pdfSafeText(`Trainer: ${session.trainer_signed_name || session.trainer_name}`));
  doc.text(pdfSafeText(`Trainer Email: ${session.trainer_email || '—'}`));
  doc.text(`Closed: ${formatDateTime(session.closed_at)}`);
  const trainerImageTop = doc.y + 2;
  const trainerSig = b64ToBuffer(session.trainer_signature);
  if (trainerSig) {
    try {
      doc.image(trainerSig, doc.x, trainerImageTop, { width: 200, height: 50, fit: [200, 50] });
      doc.y = trainerImageTop + 50;
    } catch {
      /* ignore */
    }
  }
  doc.fillColor('#111111');

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateCertificate, generateCertificateBuffer, generateRosterPdf, pdfSafeText };
