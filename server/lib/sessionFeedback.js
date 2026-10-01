// Trainee feedback (session_feedback, migration 023 - anonymous, one row per trainee who fills out
// the feedback QR form) summarized for the close-out email and the trainer's profile (Keeley's
// request, 2026-09-30: the feedback and its comments should reach the trainer and the office
// with the completed paperwork, and be reviewable on the trainer's profile).
//
// Since 2026-10-01 each trainer is rated separately (session_feedback_trainers, migration 074):
// stars and an optional comment per trainer, so co-trainers and each day's trainer on a
// multi-day course only get the ratings meant for them. Feedback from before that has no
// per-trainer rows and is read the old way - one rating and comment for the whole session,
// credited to everyone who taught it.
const { dbAll, dbGet } = require('../db');

// Every session a trainer taught: as lead, as a multi-day course's day trainer (assigned or
// signed), or as a co-trainer. `$1` is the trainer's employee_id.
const TAUGHT_SESSIONS_SQL = `SELECT session_id FROM training_sessions WHERE trainer_employee_id = $1
  UNION SELECT session_id FROM session_days WHERE assigned_trainer_employee_id = $1 OR signed_trainer_employee_id = $1
  UNION SELECT session_id FROM session_co_trainers WHERE trainer_employee_id = $1`;

// Feedback with no per-trainer rows - the old one-rating-per-session form.
const NO_TRAINER_ROWS = 'NOT EXISTS (SELECT 1 FROM session_feedback_trainers x WHERE x.feedback_id = sf.feedback_id)';

const YES_NO_QUESTIONS = [
  { key: 'could_ask_questions', label: 'Could ask questions' },
  { key: 'understood_material', label: 'Understood the material' },
  { key: 'needs_additional_training', label: 'Needs additional training' },
];

function average(rows, field) {
  return rows.length ? rows.reduce((sum, r) => sum + Number(r[field]), 0) / rows.length : null;
}

// Everything the close-out email shows about one session's feedback: averages (overall and per
// trainer), yes/no tallies, and every written comment (oldest first, the order they came in).
async function sessionFeedbackSummary(sessionId) {
  const rows = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [sessionId]);
  const trainerRows = rows.length
    ? await dbAll(
      `SELECT sft.*, sf.effectiveness_rating, sf.submitted_at FROM session_feedback_trainers sft
       JOIN session_feedback sf ON sf.feedback_id = sft.feedback_id
       WHERE sf.session_id = ? ORDER BY sf.submitted_at`,
      [sessionId]
    )
    : [];
  const byTrainer = new Map();
  for (const t of trainerRows) {
    const key = t.trainer_employee_id || `name:${t.trainer_name.toLowerCase()}`;
    const entry = byTrainer.get(key) || { name: t.trainer_name, ratings: [] };
    entry.ratings.push(t.rating);
    byTrainer.set(key, entry);
  }
  const withRows = new Set(trainerRows.map((t) => t.feedback_id));
  const comments = [
    ...trainerRows
      .filter((t) => t.comment && t.comment.trim())
      .map((t) => ({ text: t.comment.trim(), trainerName: t.trainer_name, trainerRating: t.rating, effectiveness: t.effectiveness_rating, submittedAt: t.submitted_at })),
    ...rows
      .filter((r) => !withRows.has(r.feedback_id) && r.trainer_comment && r.trainer_comment.trim())
      .map((r) => ({ text: r.trainer_comment.trim(), trainerName: null, trainerRating: r.trainer_rating, effectiveness: r.effectiveness_rating, submittedAt: r.submitted_at })),
  ].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  return {
    count: rows.length,
    avgTrainerRating: average(rows, 'trainer_rating'),
    avgEffectiveness: average(rows, 'effectiveness_rating'),
    trainers: [...byTrainer.values()].map((t) => ({
      name: t.name,
      count: t.ratings.length,
      avg: t.ratings.reduce((a, b) => a + b, 0) / t.ratings.length,
    })),
    questions: YES_NO_QUESTIONS.map((q) => ({
      label: q.label,
      yes: rows.filter((r) => r[q.key] === 'yes').length,
      no: rows.filter((r) => r[q.key] === 'no').length,
    })),
    comments,
  };
}

// A trainer's own ratings: per-trainer ratings given to them, plus old whole-session ratings on
// sessions they taught. Effectiveness rates the training, so it's every response on their sessions.
async function trainerRatingSummary(employeeId) {
  const row = await dbGet(
    `WITH ratings AS (
       SELECT sft.rating AS r FROM session_feedback_trainers sft WHERE sft.trainer_employee_id = $1
       UNION ALL
       SELECT sf.trainer_rating FROM session_feedback sf WHERE sf.session_id IN (${TAUGHT_SESSIONS_SQL}) AND ${NO_TRAINER_ROWS}
     )
     SELECT (SELECT AVG(r) FROM ratings) AS avg_trainer_rating,
            (SELECT COUNT(*) FROM ratings) AS rating_count,
            (SELECT AVG(effectiveness_rating) FROM session_feedback WHERE session_id IN (${TAUGHT_SESSIONS_SQL})) AS avg_effectiveness_rating`,
    [employeeId]
  );
  const count = Number(row.rating_count);
  // AVG() comes back from Postgres as NUMERIC (a string) - Number() it for the page's toFixed().
  return {
    avg_trainer_rating: count > 0 ? Number(row.avg_trainer_rating) : null,
    avg_effectiveness_rating: row.avg_effectiveness_rating !== null ? Number(row.avg_effectiveness_rating) : null,
    response_count: count,
  };
}

// Every written comment left for a trainer, newest first: comments written about them, plus old
// whole-session comments on sessions they taught.
async function trainerFeedbackComments(employeeId) {
  return dbAll(
    `SELECT sft.id AS feedback_id, sft.comment AS trainer_comment, sft.rating AS trainer_rating, sf.effectiveness_rating,
            sf.needs_additional_training, sf.submitted_at, ts.session_id, ts.training_type_label, ts.session_date, c.client_name
     FROM session_feedback_trainers sft
     JOIN session_feedback sf ON sf.feedback_id = sft.feedback_id
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE sft.trainer_employee_id = $1 AND TRIM(COALESCE(sft.comment, '')) <> ''
     UNION ALL
     SELECT sf.feedback_id, sf.trainer_comment, sf.trainer_rating, sf.effectiveness_rating,
            sf.needs_additional_training, sf.submitted_at, ts.session_id, ts.training_type_label, ts.session_date, c.client_name
     FROM session_feedback sf
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE TRIM(COALESCE(sf.trainer_comment, '')) <> '' AND sf.session_id IN (${TAUGHT_SESSIONS_SQL}) AND ${NO_TRAINER_ROWS}
     ORDER BY submitted_at DESC`,
    [employeeId]
  );
}

module.exports = { TAUGHT_SESSIONS_SQL, sessionFeedbackSummary, trainerRatingSummary, trainerFeedbackComments };
