// Builds "Training Title_Client_Trainer_Date_Trainee Name.pdf" (Keeley's request, 2026-09-16) -
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

function buildCertificateFilename(session, attendee) {
  const parts = [
    stripTrainingIdPrefix(session.training_type_label),
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    attendee.trainee_name,
  ].map(sanitizeFilenamePart);
  return `${parts.join('_')}.pdf`;
}

// Same convention, minus the trainee name (a roster covers every attendee, not one) - so a
// downloaded roster lands with a name that already says what it is instead of "roster-<date>",
// which every session was producing identically-prefixed files under (Keeley's request,
// 2026-09-16: keep this consistent with the certificate naming so nothing needs renaming by hand).
function buildRosterFilename(session, ext) {
  const parts = [
    stripTrainingIdPrefix(session.training_type_label),
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    'Roster',
  ].map(sanitizeFilenamePart);
  return `${parts.join('_')}.${ext}`;
}

// Same convention as the roster/certificates (Keeley's request, 2026-09-17: QR PNGs were all
// named "qrcode.png"/"feedback-qrcode.png" regardless of session, so dragging several into a
// PowerPoint left no way to tell which slide/session each belonged to).
function buildQrFilename(session, kind) {
  const parts = [
    stripTrainingIdPrefix(session.training_type_label),
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    kind,
  ].map(sanitizeFilenamePart);
  return `${parts.join('_')}.png`;
}

module.exports = { buildCertificateFilename, buildRosterFilename, buildQrFilename, stripTrainingIdPrefix };
