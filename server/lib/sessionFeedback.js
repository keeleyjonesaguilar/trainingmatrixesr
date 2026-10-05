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
const { v4: uuidv4 } = require('uuid');
const { dbAll, dbGet, dbRun } = require('../db');
const { EASTERN_TZ, parseTimestamp } = require('./dates');

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
    // Names left by trainees who said they need additional training (2026-10-05).
    followUps: rows.filter((r) => r.contact_name && r.contact_name.trim()).map((r) => r.contact_name.trim()),
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

// Feedback left on a multi-day course before trainers were rated separately counted for every
// trainer on it. Keeley's call (2026-10-05): credit each of those responses to whoever taught the
// day it was submitted (Eastern date; after the last scheduled day, the last day's trainer), so
// "John taught Day 1, Mary Day 2" shows up on the right profiles. Only courses with more than one
// day trainer change. Returns what it did (or would do, with dryRun).
async function creditOldMultiDayFeedback({ dryRun = false } = {}) {
  const { getSessionDays } = require('./sessionDays'); // eslint-disable-line global-require
  const easternDate = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ });
  const rows = await dbAll(
    `SELECT sf.*, ts.training_type_label FROM session_feedback sf JOIN training_sessions ts ON ts.session_id = sf.session_id
     WHERE ts.total_days IS NOT NULL AND ts.multi_training_day = 0 AND ${NO_TRAINER_ROWS} AND sf.trainer_rating IS NOT NULL
     ORDER BY sf.submitted_at`,
    []
  );
  const daysBySession = new Map();
  const results = [];
  for (const f of rows) {
    if (!daysBySession.has(f.session_id)) {
      // eslint-disable-next-line no-await-in-loop
      const session = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [f.session_id]);
      // eslint-disable-next-line no-await-in-loop
      daysBySession.set(f.session_id, await getSessionDays(session));
    }
    const days = daysBySession.get(f.session_id).filter((d) => d.date);
    const trainerOf = (d) => ({ name: d.signed_trainer_name || d.assigned_trainer_name, id: d.signed_trainer_name ? d.signed_trainer_employee_id : d.assigned_trainer_employee_id });
    if (new Set(days.map((d) => trainerOf(d).name)).size < 2) continue; // eslint-disable-line no-continue
    const submitted = easternDate.format(parseTimestamp(f.submitted_at));
    const day = days.find((d) => d.date === submitted) || [...days].reverse().find((d) => d.date <= submitted) || days[0];
    const trainer = trainerOf(day);
    results.push({ feedback_id: f.feedback_id, session: f.training_type_label, submitted, day: day.day_number, trainer: trainer.name, rating: f.trainer_rating });
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await dbRun(
        'INSERT INTO session_feedback_trainers (id, feedback_id, trainer_name, trainer_employee_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), f.feedback_id, trainer.name, trainer.id || null, f.trainer_rating, f.trainer_comment || null]
      );
    }
  }
  return results;
}

module.exports = { TAUGHT_SESSIONS_SQL, sessionFeedbackSummary, trainerRatingSummary, trainerFeedbackComments, creditOldMultiDayFeedback };
