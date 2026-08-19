// Certificate-of-completion + roster PDF generation for Training Sign-In sessions. Both live
// on the same persistent disk as the rest of the app's data (server/db.js's DATA_DIR), under
// their own subfolders (certificates/sign-in-sessions/<session>/, rosters/) so they never
// collide with manually-uploaded certificates (DATA_DIR/certificates/<recordId>-<ts>.ext).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

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

// One certificate of completion per attendee.
function generateCertificate(session, attendee) {
  const dir = path.join(DATA_DIR, 'certificates', 'sign-in-sessions', session.session_id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${attendee.attendee_id}.pdf`);

  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Border
  doc
    .lineWidth(3)
    .strokeColor('#111111')
    .rect(24, 24, doc.page.width - 48, doc.page.height - 48)
    .stroke();

  doc
    .fillColor('#111111')
    .fontSize(12)
    .font('Helvetica')
    .text('ESR SAFETY TRAINING', 0, 60, { align: 'center', characterSpacing: 2 });

  doc
    .fontSize(30)
    .font('Helvetica-Bold')
    .text('Certificate of Completion', 0, 90, { align: 'center' });

  doc
    .moveDown(1.5)
    .fontSize(14)
    .font('Helvetica')
    .text('This certifies that', { align: 'center' });

  doc
    .moveDown(0.5)
    .fontSize(26)
    .font('Helvetica-Bold')
    .text(attendee.trainee_name, { align: 'center' });

  doc
    .moveDown(0.5)
    .fontSize(14)
    .font('Helvetica')
    .text('has successfully completed the training', { align: 'center' });

  doc
    .moveDown(0.5)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(session.training_type_label, { align: 'center' });

  doc
    .moveDown(0.3)
    .fontSize(12)
    .font('Helvetica')
    .text(`for ${session.client_name}`, { align: 'center' });

  doc
    .moveDown(0.3)
    .fontSize(12)
    .text(`Completed on ${formatDate(session.session_date)}`, { align: 'center' });

  // Signature block
  const sigY = doc.page.height - 170;
  const leftX = 120;
  const rightX = doc.page.width - 120 - 220;

  const traineeSig = b64ToBuffer(attendee.signature);
  if (traineeSig) {
    try {
      doc.image(traineeSig, leftX, sigY - 55, { width: 220, height: 60, fit: [220, 60] });
    } catch {
      /* ignore bad image data */
    }
  }
  doc.moveTo(leftX, sigY).lineTo(leftX + 220, sigY).stroke();
  doc.fontSize(11).text(attendee.trainee_name, leftX, sigY + 5, { width: 220, align: 'center' });
  doc.fontSize(9).fillColor('#555555').text('Trainee Signature', leftX, sigY + 20, { width: 220, align: 'center' });

  const trainerSig = b64ToBuffer(session.trainer_signature);
  if (trainerSig) {
    try {
      doc.image(trainerSig, rightX, sigY - 55, { width: 220, height: 60, fit: [220, 60] });
    } catch {
      /* ignore bad image data */
    }
  }
  doc.fillColor('#111111').moveTo(rightX, sigY).lineTo(rightX + 220, sigY).stroke();
  doc
    .fontSize(11)
    .text(session.trainer_signed_name || session.trainer_name, rightX, sigY + 5, {
      width: 220,
      align: 'center',
    });
  doc.fontSize(9).fillColor('#555555').text('Trainer Signature', rightX, sigY + 20, { width: 220, align: 'center' });

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
