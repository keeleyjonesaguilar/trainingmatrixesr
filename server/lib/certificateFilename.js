// Builds "Training Title_Client_Trainer_Date_Trainee Name.pdf" (Keeley's request, 2026-09-16) -
// used for both a single certificate download and each entry inside the bulk ZIP, so a file
// distributed either way is immediately identifiable without opening it.
function sanitizeFilenamePart(s) {
  // Strips characters that are illegal (or awkward) in a filename on Windows/macOS/most zip
  // tools, but leaves spaces alone - the requested format keeps them within each field, only
  // using underscores as the separator between fields.
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim();
}

function buildCertificateFilename(session, attendee) {
  const parts = [
    session.training_type_label,
    session.client_name,
    session.trainer_signed_name || session.trainer_name,
    session.session_date,
    attendee.trainee_name,
  ].map(sanitizeFilenamePart);
  return `${parts.join('_')}.pdf`;
}

module.exports = { buildCertificateFilename };
