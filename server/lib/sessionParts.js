// Multi Training Day (migration 075, Keeley's request, 2026-10-05): several trainings back to back
// on one day, each with its own check-in. It rides on the multi-day attendance columns -
// total_days is the number of trainings and current_day the one open for check-in - so anything
// that means "a course over several days" has to ask isMultiDay(), not just look at total_days.
const { dbAll } = require('../db');

function isMultiTrainingDay(session) {
  return Boolean(session && Number(session.multi_training_day));
}

// A real multi-day course (OSHA 10/30): per-day trainers, sign-offs and reminders, and an
// attendee has to make every day to be certified.
function isMultiDay(session) {
  return Boolean(session && session.total_days) && !isMultiTrainingDay(session);
}

// The trainings of a Multi Training Day in check-in order: 1 is the session's own training, 2+
// the additional trainings in display order. `additionalTrainings` can be passed when the caller
// already has them.
async function trainingParts(session, additionalTrainings = null) {
  const extras = additionalTrainings
    || await dbAll('SELECT * FROM session_additional_trainings WHERE session_id = ? ORDER BY display_order', [session.session_id]);
  return [
    {
      number: 1,
      label: session.training_type_label,
      duration: session.duration || null,
      master_training_id: session.master_training_id || null,
      additional_training: null,
    },
    ...extras.map((t, i) => ({
      number: i + 2,
      label: t.training_type_label,
      duration: t.duration || null,
      master_training_id: t.master_training_id || null,
      additional_training: t,
    })),
  ];
}

module.exports = { isMultiTrainingDay, isMultiDay, trainingParts };
