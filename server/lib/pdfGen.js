// Certificate-of-completion + roster PDF generation for Training Sign-In sessions. Both live
// on the same persistent disk as the rest of the app's data (server/db.js's DATA_DIR), under
// their own subfolders (certificates/sign-in-sessions/<session>/, rosters/) so they never
// collide with manually-uploaded certificates (DATA_DIR/certificates/<recordId>-<ts>.ext).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
// The actual approved letterhead (Keeley's request, 2026-09-16 - after two hand-drawn attempts
// at recreating the background graphic didn't match, she supplied this exported PNG directly).
// Everything static (logo, address, chevron graphic, headings, footer labels/lines) is baked
// into this image; the code below only draws the 4 dynamic fields on top of it.
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'Training Certificate Template.png');
const ESR_GREEN = '#1B5E42';

// Simulates the template's small-caps display font (a tall initial capital, smaller capitals
// for the rest of each word) using the built-in Times-Roman font, since PDFKit can't apply an
// OpenType small-caps feature and no matching font file was supplied. Returns the y one line
// below what was drawn, for stacking multiple centered lines.
function measureSmallCapsWord(doc, word, bigSize, smallSize) {
  const first = word.charAt(0).toUpperCase();
  const rest = word.slice(1).toUpperCase();
  doc.fontSize(bigSize);
  const firstWidth = doc.widthOfString(first);
  doc.fontSize(smallSize);
  const restWidth = doc.widthOfString(rest);
  return { first, rest, width: firstWidth + restWidth, firstWidth };
}

function drawSmallCapsLine(doc, text, { x, width, baselineY, bigSize, smallSize, color, font = 'Times-Roman' }) {
  doc.font(font).fillColor(color);
  const words = text.split(' ').filter(Boolean);
  const spaceWidth = (() => {
    doc.fontSize(smallSize);
    return doc.widthOfString(' ');
  })();
  const measured = words.map((w) => measureSmallCapsWord(doc, w, bigSize, smallSize));
  const totalWidth = measured.reduce((sum, m) => sum + m.width, 0) + spaceWidth * (words.length - 1);

  let cursorX = x + (width - totalWidth) / 2;
  const bigY = baselineY - bigSize * 0.72;
  const smallY = baselineY - smallSize * 0.72;
  for (const m of measured) {
    doc.font(font).fontSize(bigSize).text(m.first, cursorX, bigY, { lineBreak: false });
    cursorX += m.firstWidth;
    doc.font(font).fontSize(smallSize).text(m.rest, cursorX, smallY, { lineBreak: false });
    cursorX += m.width - m.firstWidth + spaceWidth;
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
const EASTERN_TZ = 'America/New_York';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
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
  const dt = new Date(d);
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

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.image(TEMPLATE_PATH, 0, 0, { width: pageWidth, height: pageHeight });

  // Text region the template reserves for "CERTIFICATE OF TRAINING" / "Proudly presented to :" /
  // "For successfully..." - name and training title are centered within this same column.
  const contentLeft = pageWidth * 0.365;
  const contentWidth = pageWidth * 0.95 - contentLeft;

  drawSmallCapsLine(doc, attendee.trainee_name, {
    x: contentLeft,
    width: contentWidth,
    baselineY: pageHeight * 0.565,
    bigSize: 32,
    smallSize: 22,
    color: '#1A1A1A',
  });

  drawWrappedSmallCaps(doc, session.training_type_label, {
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
  doc
    .fillColor(ESR_GREEN)
    .font('Helvetica')
    .fontSize(13)
    .text(session.trainer_signed_name || session.trainer_name || '', pageWidth * 0.665, footerValueY, { width: pageWidth * 0.866 - pageWidth * 0.665, align: 'center' });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// One roster PDF per session listing every attendee + both signatures.
function generateRosterPdf(session, attendees) {
  const dir = path.join(DATA_DIR, 'rosters');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${session.session_id}.pdf`);

  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(18).font('Helvetica-Bold').text('Training Sign-In Roster');
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica');
  doc.text(`Client: ${session.client_name}`);
  doc.text(`Training: ${session.training_type_label}`);
  doc.text(`Trainer: ${session.trainer_signed_name || session.trainer_name}`);
  doc.text(`Date: ${formatDate(session.session_date)}`);
  if (session.outline) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Outline / Topics Covered:');
    doc.font('Helvetica').text(session.outline);
  }
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text(`Attendees (${attendees.length})`);
  doc.moveDown(0.3);

  const SIG_W = 160;
  const SIG_H = 40;

  attendees.forEach((a, i) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    const rowLeft = doc.x;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(`${i + 1}. ${a.trainee_name}`);
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(`Phone: ${a.trainee_phone || '—'}    Email: ${a.trainee_email || '—'}    Signed: ${formatDateTime(a.signed_at)}`);
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

  // Trainer sign-off
  if (doc.y > doc.page.height - 180) doc.addPage();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text('Trainer Sign-Off');
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  doc.text(`Trainer: ${session.trainer_signed_name || session.trainer_name}`);
  doc.text(`Trainer Email: ${session.trainer_email || '—'}`);
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

module.exports = { generateCertificate, generateRosterPdf };
