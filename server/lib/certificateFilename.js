// Builds "Training Title_Client_Date_Trainee Name.pdf" (Keeley's request, 2026-09-16) -
// used for both a single certificate download and each entry inside the bulk ZIP, so a file
// distributed either way is immediately identifiable without opening it.
function sanitizeFilenamePart(s) {
  // Strips characters that are illegal (or awkward) in a filename on Windows/macOS/most zip
  // tools, but leaves spaces alone - the requested format keeps them within each field, only
  // using underscores as the separator between fields.
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim();
}

// A training's label is sometimes typed/imported as "TRN-007 - Ladder Safety" rather than just
// "Ladder Safety" - fine for display, but stacked with client/trainer/date/name across every
// entry in a bulk ZIP it was pushing real file paths past Windows' ~260-char limit ("path name
// too long", Keeley's report, 2026-09-16). The catalog ID adds nothing the filename needs, so
// it's stripped here, filename-only - the master training catalog and every other field keep it.
function stripTrainingIdPrefix(label) {
  return String(label || '').replace(/^TRN-\d+\s*[-–—:]\s*/i, '');
}

// Even with the TRN-ID prefix stripped above, some catalog names are still long enough on their
// own ("PIT Operator: Class I – Electric motor, sit-down or stand-up rider trucks
// (counterbalanced forklifts)") that stacking client/trainer/date/trainee name around one still
// pushes the whole path past Windows' ~260-char limit ("path name too long", Keeley's report,
// 2026-09-22 - the TRN-ID fix from 2026-09-16 wasn't enough on its own). Rather than special-case
// which field is "least important," this trims whichever field is currently longest, one
// character at a time, until the joined name fits comfortably under that limit even inside a
// nested download folder - so it degrades gracefully no matter which field turns out to be huge.
const MAX_FILENAME_CHARS = 180;
const MIN_PART_CHARS = 10;

function capTotalLength(parts) {
  const arr = [...parts];
  const totalLength = () => arr.reduce((sum, p) => sum + p.length, 0) + (arr.length - 1);
  while (totalLength() > MAX_FILENAME_CHARS) {
    let longestIndex = 0;
    for (let i = 1; i < arr.length; i += 1) {
      if (arr[i].length > arr[longestIndex].length) longestIndex = i;
    }
    if (arr[longestIndex].length <= MIN_PART_CHARS) break; // nothing left that's safe to trim further
    arr[longestIndex] = arr[longestIndex].slice(0, -1).trim();
  }
  return arr;
}

// "Evolution Safety Resources" -> "ESR" in certificate filenames (Keeley's request, 2026-09-22) -
// ESR's own internal sessions put the full company name in every certificate's filename.
function shortClientName(clientName) {
  return /^evolution safety resources\b/i.test(String(clientName || '').trim())
    ? String(clientName).trim().replace(/^evolution safety resources/i, 'ESR')
    : clientName;
}

// Certificates skip the trainer's name (Keeley's request, 2026-09-22) - it's on the certificate
// itself and made every filename longer: "Training_Client_Date_Trainee Name.pdf".
function buildCertificateFilename(session, attendee) {
  const parts = capTotalLength([
    stripTrainingIdPrefix(session.training_type_label),
    shortClientName(session.client_name),
    session.session_date,
    attendee.trainee_name,
  ].map(sanitizeFilenamePart));
  return `${parts.join('_')}.pdf`;
}

// Same convention, minus the trainee name (a roster covers every attendee, not one) - so a
// downloaded roster lands with a name that already says what it is instead of "roster-<date>",
// which every session was producing identically-prefixed files under (Keeley's request,
// 2026-09-16: keep this consistent with the certificate naming so nothing needs renaming by hand).
function buildRosterFilename(session, ext) {
  const parts = capTotalLength([
    stripTrainingIdPrefix(session.training_type_label),
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    'Roster',
  ].map(sanitizeFilenamePart));
  return `${parts.join('_')}.${ext}`;
}

// Same convention as the roster/certificates (Keeley's request, 2026-09-17: QR PNGs were all
// named "qrcode.png"/"feedback-qrcode.png" regardless of session, so dragging several into a
// PowerPoint left no way to tell which slide/session each belonged to).
function buildQrFilename(session, kind) {
  const parts = capTotalLength([
    stripTrainingIdPrefix(session.training_type_label),
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    kind,
  ].map(sanitizeFilenamePart));
  return `${parts.join('_')}.png`;
}

module.exports = { buildCertificateFilename, buildRosterFilename, buildQrFilename, stripTrainingIdPrefix, shortClientName };
