// Trainee feedback (session_feedback, migration 023 - anonymous, one row per trainee who fills out
// the feedback QR form) summarized for the close-out email and the trainer's profile (Keeley's
// request, 2026-09-30: the feedback and its comments should reach the trainer and the office
// with the completed paperwork, and be reviewable on the trainer's profile).
const { dbAll } = require('../db');

const YES_NO_QUESTIONS = [
  { key: 'could_ask_questions', label: 'Could ask questions' },
  { key: 'understood_material', label: 'Understood the material' },
  { key: 'needs_additional_training', label: 'Needs additional training' },
];

function average(rows, field) {
  return rows.length ? rows.reduce((sum, r) => sum + Number(r[field]), 0) / rows.length : null;
}

// Everything the close-out email shows about one session's feedback: averages, yes/no tallies,
// and every written comment (oldest first, the order they came in).
async function sessionFeedbackSummary(sessionId) {
  const rows = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [sessionId]);
  return {
    count: rows.length,
    avgTrainerRating: average(rows, 'trainer_rating'),
    avgEffectiveness: average(rows, 'effectiveness_rating'),
    questions: YES_NO_QUESTIONS.map((q) => ({
      label: q.label,
      yes: rows.filter((r) => r[q.key] === 'yes').length,
      no: rows.filter((r) => r[q.key] === 'no').length,
    })),
    comments: rows
      .filter((r) => r.trainer_comment && r.trainer_comment.trim())
      .map((r) => ({ text: r.trainer_comment.trim(), trainerRating: r.trainer_rating, effectiveness: r.effectiveness_rating, submittedAt: r.submitted_at })),
  };
}

// Every written comment left for a trainer, across every session they taught (lead trainer or a
// day of a multi-day session - same rule as the profile's rating averages), newest first.
async function trainerFeedbackComments(employeeId) {
  return dbAll(
    `SELECT sf.feedback_id, sf.trainer_comment, sf.trainer_rating, sf.effectiveness_rating, sf.needs_additional_training,
            sf.submitted_at, ts.session_id, ts.training_type_label, ts.session_date, c.client_name
     FROM session_feedback sf
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE sf.trainer_comment IS NOT NULL AND TRIM(sf.trainer_comment) <> ''
       AND sf.session_id IN (SELECT session_id FROM training_sessions WHERE trainer_employee_id = ?
                             UNION SELECT session_id FROM session_days WHERE assigned_trainer_employee_id = ? OR signed_trainer_employee_id = ?)
     ORDER BY sf.submitted_at DESC`,
    [employeeId, employeeId, employeeId]
  );
}

module.exports = { sessionFeedbackSummary, trainerFeedbackComments };
