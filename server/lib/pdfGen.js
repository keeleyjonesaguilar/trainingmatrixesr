// Certificate-of-completion + roster PDF generation for Training Sign-In sessions. Both live
// on the same persistent disk as the rest of the app's data (server/db.js's DATA_DIR), under
// their own subfolders (certificates/sign-in-sessions/<session>/, rosters/) so they never
// collide with manually-uploaded certificates (DATA_DIR/certificates/<recordId>-<ts>.ext).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'esr-logo-full.png');

// ESR brand colors for the certificate (Keeley's requested redesign) - not defined elsewhere
// in the codebase (the app's own UI uses a neutral gray palette), so picked to match the ESR
// logo/letterhead itself. Background is left plain white (not a cream wash) because the
// captured signature images are painted on an opaque white canvas (SignaturePad.jsx) - anything
// other than white behind them would show as a visible box around the signature.
const ESR_GREEN = '#1B5E42';
const ESR_GOLD = '#C9A227';

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

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// One certificate of completion per attendee - matches the ESR letterhead template (Keeley's
// redesign request): cream background, green chevron border bleeding off both edges, logo +
// address block, gold divider, "CERTIFICATE / OF TRAINING" heading, and a single Trainer
// Name/Trainer Signature sign-off (the trainee's own signature isn't repeated here since their
// name is already the certificate's subject - it's shown instead in the app's Completed
// Trainings table for each employee).
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

  const contentLeft = 90;
  const contentWidth = pageWidth - contentLeft * 2;

  let logoBottom = 40;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, pageWidth / 2 - 110, 30, { width: 220 });
      logoBottom = 30 + 60;
    } catch {
      /* ignore bad logo file */
    }
  }

  doc
    .fillColor('#333333')
    .font('Helvetica')
    .fontSize(10)
    .text('5171 Glenwood Ave, Suite 365 Raleigh NC 27612', contentLeft, logoBottom, { width: contentWidth, align: 'center' })
    .text('Tel: 919-858-6781', contentLeft, doc.y, { width: contentWidth, align: 'center' })
    .text('info@evolutionsafetyresources.com', contentLeft, doc.y, { width: contentWidth, align: 'center' });

  const dividerY = doc.y + 12;
  doc
    .strokeColor(ESR_GOLD)
    .lineWidth(1.5)
    .moveTo(contentLeft + 30, dividerY)
    .lineTo(pageWidth - contentLeft - 30, dividerY)
    .stroke();

  doc
    .fillColor(ESR_GREEN)
    .font('Helvetica-Bold')
    .fontSize(34)
    .text('CERTIFICATE', contentLeft, dividerY + 20, { width: contentWidth, align: 'center', characterSpacing: 6 });

  doc
    .font('Helvetica')
    .fontSize(17)
    .text('OF TRAINING', contentLeft, doc.y + 2, { width: contentWidth, align: 'center', characterSpacing: 5 });

  doc
    .font('Helvetica')
    .fontSize(13)
    .text('This certifies that', contentLeft, doc.y + 22, { width: contentWidth, align: 'center' });

  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .text(attendee.trainee_name, contentLeft, doc.y + 10, { width: contentWidth, align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(13)
    .text('has successfully completed the training', contentLeft, doc.y + 12, { width: contentWidth, align: 'center' });

  doc
    .font('Helvetica-Bold')
    .fontSize(19)
    .text(session.training_type_label, contentLeft, doc.y + 8, { width: contentWidth, align: 'center' });

  doc
    .font('Helvetica')
    .fontSize(13)
    .text(`Completed on ${formatDate(session.session_date)}`, contentLeft, doc.y + 18, { width: contentWidth, align: 'center' });

  // Trainer sign-off - two columns: typed name on the left, the trainer's own captured
  // signature image on the right, matching the template's "Trainer Name" / "Trainer Signature".
  const sigLineY = pageHeight - 90;
  const colWidth = 220;
  const leftX = contentLeft + 20;
  const rightX = pageWidth - contentLeft - 20 - colWidth;

  doc
    .fillColor(ESR_GREEN)
    .font('Helvetica')
    .fontSize(13)
    .text(session.trainer_signed_name || session.trainer_name || '', leftX, sigLineY - 20, { width: colWidth, align: 'center' });
  doc.strokeColor(ESR_GOLD).lineWidth(1.5).moveTo(leftX, sigLineY).lineTo(leftX + colWidth, sigLineY).stroke();
  doc.fillColor(ESR_GREEN).font('Helvetica').fontSize(11).text('Trainer Name', leftX, sigLineY + 6, { width: colWidth, align: 'center' });

  const trainerSig = b64ToBuffer(session.trainer_signature);
  if (trainerSig) {
    try {
      doc.image(trainerSig, rightX + (colWidth - 140) / 2, sigLineY - 45, { width: 140, height: 40, fit: [140, 40] });
    } catch {
      /* ignore bad image data */
    }
  }
  doc.strokeColor(ESR_GOLD).lineWidth(1.5).moveTo(rightX, sigLineY).lineTo(rightX + colWidth, sigLineY).stroke();
  doc.fillColor(ESR_GREEN).font('Helvetica').fontSize(11).text('Trainer Signature', rightX, sigLineY + 6, { width: colWidth, align: 'center' });

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
    doc.text(`Phone: ${a.trainee_phone || '—'}    Signed: ${new Date(a.signed_at).toLocaleString()}`);
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
  doc.text(`Closed: ${session.closed_at ? new Date(session.closed_at).toLocaleString() : '—'}`);
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
