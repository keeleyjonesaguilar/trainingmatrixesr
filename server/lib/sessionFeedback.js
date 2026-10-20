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
const { nameKey } = require('./names');

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
//
// `forTrainer` ({ employeeIds, nameKeys } - Sets) narrows it to the responses that rated that
// trainer, and only their own ratings and comments: a multi-day course's Day 2 trainer never sees
// Day 1's feedback (Keeley's request, 2026-10-14).
async function sessionFeedbackSummary(sessionId, { forTrainer = null } = {}) {
  let rows = await dbAll('SELECT * FROM session_feedback WHERE session_id = ? ORDER BY submitted_at', [sessionId]);
  let trainerRows = rows.length
    ? await dbAll(
      `SELECT sft.*, sf.effectiveness_rating, sf.submitted_at FROM session_feedback_trainers sft
       JOIN session_feedback sf ON sf.feedback_id = sft.feedback_id
       WHERE sf.session_id = ? ORDER BY sf.submitted_at`,
      [sessionId]
    )
    : [];
  if (forTrainer) {
    trainerRows = trainerRows.filter((t) => forTrainer.employeeIds.has(t.trainer_employee_id) || forTrainer.nameKeys.has(nameKey(t.trainer_name)));
    const theirs = new Set(trainerRows.map((t) => t.feedback_id));
    rows = rows.filter((r) => theirs.has(r.feedback_id));
  }
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
    avgTrainerRating: forTrainer ? average(trainerRows, 'rating') : average(rows, 'trainer_rating'),
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
    `SELECT sft.id AS feedback_id, sft.comment AS trainer_comment, sft.comment_original AS trainer_comment_original, sft.rating AS trainer_rating, sf.effectiveness_rating,
            sf.needs_additional_training, sf.submitted_at, ts.session_id, ts.training_type_label, ts.session_date, c.client_name
     FROM session_feedback_trainers sft
     JOIN session_feedback sf ON sf.feedback_id = sft.feedback_id
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE sft.trainer_employee_id = $1 AND TRIM(COALESCE(sft.comment, '')) <> ''
     UNION ALL
     SELECT sf.feedback_id, sf.trainer_comment, sf.trainer_comment_original, sf.trainer_rating, sf.effectiveness_rating,
            sf.needs_additional_training, sf.submitted_at, ts.session_id, ts.training_type_label, ts.session_date, c.client_name
     FROM session_feedback sf
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE TRIM(COALESCE(sf.trainer_comment, '')) <> '' AND sf.session_id IN (${TAUGHT_SESSIONS_SQL}) AND ${NO_TRAINER_ROWS}
     ORDER BY submitted_at DESC`,
    [employeeId]
  );
}

// A trainer's feedback for the Training Portal (Keeley's request, 2026-10-15: "a nice section, not
// just a long running list"), grouped by class, newest class first: each class's rating and
// effectiveness averages and the written comments, plus how their ratings spread across 1-5 stars.
// Only what was meant for them - their own per-trainer ratings and comments, plus old whole-session
// feedback on classes they taught. Trainee names (the office's follow-up list) never appear.
async function trainerFeedbackByClass(employeeId) {
  const rows = await dbAll(
    `SELECT sft.rating AS rating, sft.comment AS comment, sf.effectiveness_rating, sf.submitted_at,
            ts.session_id, ts.training_type_label, ts.session_date, ts.day_dates, c.client_name
     FROM session_feedback_trainers sft
     JOIN session_feedback sf ON sf.feedback_id = sft.feedback_id
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE sft.trainer_employee_id = $1
     UNION ALL
     SELECT sf.trainer_rating, sf.trainer_comment, sf.effectiveness_rating, sf.submitted_at,
            ts.session_id, ts.training_type_label, ts.session_date, ts.day_dates, c.client_name
     FROM session_feedback sf
     JOIN training_sessions ts ON ts.session_id = sf.session_id
     JOIN clients c ON c.client_id = ts.client_id
     WHERE sf.session_id IN (${TAUGHT_SESSIONS_SQL}) AND ${NO_TRAINER_ROWS}
     ORDER BY submitted_at DESC`,
    [employeeId]
  );
  const classes = new Map();
  const distribution = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const rating = Number(r.rating);
    if (rating >= 1 && rating <= 5) distribution[Math.round(rating) - 1] += 1;
    const entry = classes.get(r.session_id) || {
      session_id: r.session_id,
      training: r.training_type_label,
      client: r.client_name,
      date: r.session_date,
      day_dates: r.day_dates ? JSON.parse(r.day_dates) : null,
      ratings: [],
      effectiveness: [],
      comments: [],
    };
    if (rating) entry.ratings.push(rating);
    if (r.effectiveness_rating) entry.effectiveness.push(Number(r.effectiveness_rating));
    if (r.comment && r.comment.trim()) entry.comments.push({ text: r.comment.trim(), rating: rating || null, submitted_at: r.submitted_at });
    classes.set(r.session_id, entry);
  }
  const avg = (list) => (list.length ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(2)) : null);
  return {
    distribution: { 1: distribution[0], 2: distribution[1], 3: distribution[2], 4: distribution[3], 5: distribution[4] },
    comment_count: [...classes.values()].reduce((n, c) => n + c.comments.length, 0),
    classes: [...classes.values()]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(({ ratings, effectiveness, ...c }) => ({ ...c, responses: ratings.length, avg_rating: avg(ratings), avg_effectiveness: avg(effectiveness) })),
  };
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

module.exports = {
  TAUGHT_SESSIONS_SQL, sessionFeedbackSummary, trainerRatingSummary, trainerFeedbackComments, trainerFeedbackByClass, creditOldMultiDayFeedback,
};
