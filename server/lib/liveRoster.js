// The trainer's live roster (Keeley's request, 2026-10-07: trainers kept asking the office who had
// signed in) - shared by the sign-in page's trainer tab (behind the trainer PIN,
// routes/publicSessions.js) and the Training Portal's "View roster" button (signed-in trainers on
// that session, routes/portal.js, 2026-10-12). Names and sign-in times only, never contact details
// or signatures. Phone numbers are only used here to flag likely double sign-ins, the same way
// the trainer edit page does.
const { dbAll } = require('../db');
const { nameKey } = require('./names');
const { isMultiTrainingDay, trainingParts } = require('./sessionParts');

async function liveRoster(session) {
  // A-Z by last name, so a trainer can find someone quickly and double sign-ins sit together.
  const rows = await dbAll(
    `SELECT attendee_id, trainee_name, trainee_phone, signed_at FROM session_attendees WHERE session_id = ?
     ORDER BY LOWER(COALESCE(NULLIF(trainee_last_name, ''), trainee_name)), LOWER(trainee_name), signed_at`,
    [session.session_id]
  );
  const days = session.total_days
    ? await dbAll('SELECT attendee_id, day_number FROM session_attendance_days WHERE session_id = ?', [session.session_id])
    : [];

  // Same name or same phone as another sign-in - the usual sign of someone signing in twice.
  const groups = new Map();
  for (const r of rows) {
    const keys = [`name:${nameKey(r.trainee_name)}`];
    const phone = String(r.trainee_phone || '').replace(/\D/g, '');
    if (phone) keys.push(`phone:${phone}`);
    for (const key of keys) groups.set(key, [...(groups.get(key) || []), r.attendee_id]);
  }
  const duplicates = new Set([...groups.values()].filter((g) => g.length > 1).flat());

  const multiTrainingDay = isMultiTrainingDay(session);
  return {
    status: session.status,
    total_days: session.total_days,
    current_day: session.current_day,
    multi_training_day: multiTrainingDay,
    // A Multi Training Day's trainings in check-in order, for "Checked in for <training>".
    trainings: multiTrainingDay ? (await trainingParts(session)).map((p) => p.label) : null,
    attendees: rows.map((r) => {
      const daysAttended = days.filter((d) => d.attendee_id === r.attendee_id).map((d) => d.day_number).sort((a, b) => a - b);
      return {
        attendee_id: r.attendee_id,
        trainee_name: r.trainee_name,
        signed_at: r.signed_at,
        days_attended: daysAttended,
        here_now: !session.total_days || daysAttended.includes(session.current_day),
        possible_duplicate: duplicates.has(r.attendee_id),
      };
    }),
  };
}

module.exports = { liveRoster };
