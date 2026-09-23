// Fills the actual official AHA Heartsaver Course Roster PDF (server/assets/aha-heartsaver-
// course-roster.pdf) with this session's data - Keeley's requirement, 2026-09-21: AHA won't
// accept anything that isn't identical to their own form, so this draws nothing of its own on
// the base document and only sets values on the template's real AcroForm fields. Only ever
// called for First Aid/CPR/AED (TRN-020) sessions - see server/lib/ahaCourseOptions.js for the
// page-1 checkbox mapping.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PNG } = require('pngjs');
const { AHA_COURSE_OPTIONS } = require('./ahaCourseOptions');
const { AHA_OPTIONAL_TOPICS } = require('./ahaOptionalTopics');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'aha-heartsaver-course-roster.pdf');

// The form's Course Participants table (page 2) only has 10 rows - a hard limit of the original
// AHA document itself. A class bigger than that gets one or more extra copies of that same page
// appended (Keeley's call, 2026-09-21) - see addOverflowPage() below for why those extra copies
// can't just reuse the template's own form fields.
const MAX_ROSTER_ROWS = 10;

// x/y (PDF points, origin bottom-left) of each of the 10 row slots on the Course Participants
// page, read directly off the template's own "Name N"/"Email N"/"Telephone N"/"Complete-
// Incomplete N" field rectangles - reused here only for the hand-drawn overflow page(s), since
// the real fields already place row 1-10 correctly on the base page.
const ROW_POSITIONS = [
  { name: { x: 51, y: 437 }, email: { x: 51, y: 417 }, phone: { x: 325, y: 417 }, complete: { x: 589, y: 428 } },
  { name: { x: 51, y: 396 }, email: { x: 51, y: 376 }, phone: { x: 325, y: 376 }, complete: { x: 589, y: 386 } },
  { name: { x: 51, y: 352 }, email: { x: 51, y: 332 }, phone: { x: 325, y: 332 }, complete: { x: 589, y: 343 } },
  { name: { x: 51, y: 311 }, email: { x: 51, y: 291 }, phone: { x: 325, y: 291 }, complete: { x: 589, y: 302 } },
  { name: { x: 51, y: 270 }, email: { x: 51, y: 250 }, phone: { x: 325, y: 250 }, complete: { x: 589, y: 260 } },
  { name: { x: 51, y: 228 }, email: { x: 51, y: 208 }, phone: { x: 325, y: 208 }, complete: { x: 589, y: 219 } },
  { name: { x: 51, y: 185 }, email: { x: 51, y: 165 }, phone: { x: 325, y: 165 }, complete: { x: 589, y: 176 } },
  { name: { x: 51, y: 144 }, email: { x: 51, y: 124 }, phone: { x: 325, y: 124 }, complete: { x: 589, y: 134 } },
  { name: { x: 51, y: 102 }, email: { x: 51, y: 82 }, phone: { x: 325, y: 82 }, complete: { x: 589, y: 92 } },
  { name: { x: 51, y: 60 }, email: { x: 51, y: 40 }, phone: { x: 325, y: 40 }, complete: { x: 589, y: 51 } },
];
// Position of the repeated "Date / Course / Lead Instructor / Lead Instr. ID#" header row atop
// the Course Participants page - same header the real page 2 shows via its own shared fields.
const HEADER_POSITIONS = { date: { x: 58, y: 511 }, course: { x: 216, y: 511 }, instructor: { x: 424, y: 511 }, instructorId: { x: 674, y: 511 } };

// The "Signature of Lead Instructor" line's own rectangle on page 1 (read directly off the
// template's "Lead Instructor Signature" field) - the trainer's actual captured signature image
// is drawn here instead of setting the field's text (Keeley's call, 2026-09-21: this should be
// the real signature captured at close-out, not their typed name standing in for it).
const SIGNATURE_RECT = { x: 43.2, y: 65.34, width: 319.68, height: 13.5 };

function isPngDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,');
}

// Tallest the drawn signature may be - taller than the 13.5pt field box on purpose, so the
// signature rises above the line the way a handwritten one would instead of being squashed
// into the box's height, but short enough to clear the "I verify..." sentence above the line.
const SIGNATURE_MAX_HEIGHT = 20;

// The signature pad saves the whole 438x160 canvas on an opaque white background, with the ink
// covering only a small strip in the middle. Fitting that raw image to the line shrank the ink
// to a speck at the far left, and its white box blanked out the start of the printed line
// (Keeley's report, 2026-09-23). This crops to just the ink and makes the background transparent
// so the form's own line shows through. Returns null for a blank signature.
function inkOnlyPng(pngBytes) {
  const src = PNG.sync.read(pngBytes);
  const isInk = (i) => src.data[i + 3] > 20 && (src.data[i] < 200 || src.data[i + 1] < 200 || src.data[i + 2] < 200);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!isInk((y * src.width + x) * 4)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;

  const out = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const si = (y * src.width + x) * 4;
      const oi = ((y - minY) * out.width + (x - minX)) * 4;
      src.data.copy(out.data, oi, si, si + 4);
      if (!isInk(si)) out.data[oi + 3] = 0;
    }
  }
  return PNG.sync.write(out);
}

async function drawSignatureImage(doc, page, rect, signatureDataUrl) {
  if (!isPngDataUrl(signatureDataUrl)) return;
  const inkBytes = inkOnlyPng(Buffer.from(signatureDataUrl.split(',')[1], 'base64'));
  if (!inkBytes) return;
  const pngImage = await doc.embedPng(inkBytes);
  // Keep the signature's own aspect ratio, and rest its bottom just above the printed line
  // (the field box's bottom edge), starting a little in from the line's left end.
  const scale = Math.min((rect.width - 8) / pngImage.width, SIGNATURE_MAX_HEIGHT / pngImage.height);
  page.drawImage(pngImage, { x: rect.x + 8, y: rect.y + 2.5, width: pngImage.width * scale, height: pngImage.height * scale });
}

function setTextSafely(form, fieldName, value) {
  if (!value) return;
  try {
    form.getTextField(fieldName).setText(String(value));
  } catch {
    // Field genuinely missing from the template (shouldn't happen - it's the same file we
    // inspected to build this mapping) - skip rather than fail the whole roster over one field.
  }
}

// Same as setTextSafely, but shrinks the font to fit instead of using the field's fixed default
// size (Keeley's report, 2026-09-21: the Course Start/End line was clipping "AM"/"PM" off the
// end). Deliberately its own function rather than the default for every field: a field with
// multiple widgets (like "Lead Instructor" and "Date", shared between pages 1 and 2 - see
// SIGNATURE_RECT's comment) doesn't auto-size reliably across every widget in this pdf-lib
// version, so this is reserved for single-widget fields that actually risk overflowing.
function setTextAutoSize(form, fieldName, value) {
  if (!value) return;
  try {
    const field = form.getTextField(fieldName);
    field.setFontSize(0); // 0 is pdf-lib/Acrobat's convention for "size the font to fit the box"
    field.setText(String(value));
  } catch {
    /* see setTextSafely */
  }
}

function checkSafely(form, fieldName) {
  try {
    form.getCheckBox(fieldName).check();
  } catch {
    /* see setTextSafely */
  }
}

// Appends one more copy of the Course Participants page for attendees 11-20, 21-30, etc.
// A naive doc.copyPages() looks right but is wrong: the copy's "Name 1"/"Email 1"/etc. widgets
// are the *same* field as the original page's (that's how the template makes "Date"/"Course"/
// "Lead Instructor" auto-repeat between pages 1 and 2 in the first place) - filling them
// separately for two different batches of attendees isn't possible without giving each copy its
// own distinct field, which pdf-lib has no built-in way to do. Instead, `embeddedPage` is a
// snapshot of the page's plain background art (no annotations/fields), embedded from a second,
// completely untouched load of the same template - using the *main* doc's own page here would
// leak whatever form.flatten() bakes into it later, since embedPages keeps a live reference
// rather than a byte copy. Every value on this page is then just drawn as plain text at the same
// coordinates the real fields use.
function addOverflowPage(doc, font, embeddedPage, pageSize, headerValues, attendeesBatch) {
  const page = doc.insertPage(doc.getPageCount() - 1, pageSize);
  page.drawPage(embeddedPage, { x: 0, y: 0, width: pageSize[0], height: pageSize[1] });

  const drawAt = (pos, value) => {
    if (!value) return;
    page.drawText(String(value), { x: pos.x, y: pos.y, size: 9, font, color: rgb(0, 0, 0) });
  };
  drawAt(HEADER_POSITIONS.date, headerValues.date);
  drawAt(HEADER_POSITIONS.course, headerValues.course);
  drawAt(HEADER_POSITIONS.instructor, headerValues.instructor);
  drawAt(HEADER_POSITIONS.instructorId, headerValues.instructorId);

  attendeesBatch.forEach((a, i) => {
    const pos = ROW_POSITIONS[i];
    drawAt(pos.name, a.trainee_name);
    drawAt(pos.email, a.trainee_email);
    drawAt(pos.phone, a.trainee_phone);
    drawAt(pos.complete, 'Complete');
  });
}

async function generateAhaRoster(session, attendees, outputPath) {
  const filePath =
    outputPath || path.join(DATA_DIR, 'aha-rosters', `${session.session_id}.pdf`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();

  const selectedOptions = new Set(JSON.parse(session.hs_course_options || '[]'));
  for (const opt of AHA_COURSE_OPTIONS) {
    if (selectedOptions.has(opt.key)) checkSafely(form, opt.field);
  }

  const selectedTopics = new Set(JSON.parse(session.hs_optional_topics || '[]'));
  for (const topic of AHA_OPTIONAL_TOPICS) {
    if (selectedTopics.has(topic.key)) checkSafely(form, topic.field);
  }

  const additionalInstructors = JSON.parse(session.hs_additional_instructors || '[]');
  additionalInstructors.slice(0, 8).forEach((instructor, i) => {
    const n = i + 1;
    setTextAutoSize(form, `Name-Instructor ID ${n}`, instructor.name_id);
    setTextSafely(form, `Card Exp Date ${n}`, instructor.card_exp_date);
  });

  const leadInstructorName = session.trainer_signed_name || session.trainer_name;
  setTextSafely(form, 'Date', session.session_date);
  setTextSafely(form, 'Course', session.training_type_label);
  setTextSafely(form, 'Lead Instructor', leadInstructorName);
  setTextSafely(form, 'Lead Instructor ID#', session.trainer_aha_instructor_id);
  setTextSafely(form, 'Card Expriation Date', session.hs_card_expiration_date);
  setTextSafely(form, 'Training Center', session.hs_training_center);
  setTextSafely(form, 'Training Center ID#', session.hs_training_center_id);
  setTextSafely(form, 'Training Site Name', session.hs_training_site_name);
  setTextSafely(form, 'Address', session.hs_address);
  setTextSafely(form, 'City, State ZIP', session.hs_city_state_zip);
  setTextSafely(form, 'Course Location', session.location);
  setTextAutoSize(form, 'Course Start', session.hs_course_start);
  setTextAutoSize(form, 'Course End', session.hs_course_end);
  setTextSafely(form, 'Total Hours', session.hs_total_hours);
  setTextSafely(form, 'No of Cards Issued', session.hs_no_of_cards_issued);
  setTextSafely(form, 'Student-Manikin Ratio', session.hs_student_manikin_ratio);
  setTextSafely(form, 'Issue Date of Cards', session.hs_issue_date_of_cards);
  await drawSignatureImage(doc, doc.getPages()[0], SIGNATURE_RECT, session.trainer_signature);

  const firstBatch = attendees.slice(0, MAX_ROSTER_ROWS);
  firstBatch.forEach((a, i) => {
    const n = i + 1;
    setTextSafely(form, `Name ${n}`, a.trainee_name);
    setTextSafely(form, `Email ${n}`, a.trainee_email);
    setTextSafely(form, `Telephone ${n}`, a.trainee_phone);
    // Every signed-in attendee got a certificate at close-out, so "Complete" is accurate by
    // default - there's no remediation/partial-completion tracking in this app to draw a
    // different answer from (Keeley's call, 2026-09-21: skip that for now).
    setTextSafely(form, `Complete-Incomplete ${n}`, 'Complete');
  });

  const overflow = attendees.slice(MAX_ROSTER_ROWS);
  if (overflow.length > 0) {
    const pristineDoc = await PDFDocument.load(templateBytes);
    const templateParticipantsPage = pristineDoc.getPages()[1];
    const pageSize = [templateParticipantsPage.getWidth(), templateParticipantsPage.getHeight()];
    const [embeddedPage] = await doc.embedPages([templateParticipantsPage]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const headerValues = {
      date: session.session_date,
      course: session.training_type_label,
      instructor: leadInstructorName,
      instructorId: session.trainer_aha_instructor_id,
    };
    for (let i = 0; i < overflow.length; i += MAX_ROSTER_ROWS) {
      addOverflowPage(doc, font, embeddedPage, pageSize, headerValues, overflow.slice(i, i + MAX_ROSTER_ROWS));
    }
  }

  // Flatten so every viewer (not just one with full Acrobat) renders the filled-in values
  // identically, and the file can't be accidentally edited further downstream.
  form.flatten();

  const filledBytes = await doc.save();
  fs.writeFileSync(filePath, filledBytes);
  return filePath;
}

module.exports = { generateAhaRoster, MAX_ROSTER_ROWS };
