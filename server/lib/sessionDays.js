// Per-day trainers and sign-offs for multi-day sessions (server/migrations/064_session_days.sql,
// Keeley's request, 2026-09-29). A day's assigned trainer defaults to the session's own trainer,
// so a course taught by one person needs nothing extra; each day's trainer signs off at the end
// of their day (routes/publicSessions.js), and the final day's sign-off is the normal close-out.
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const repo = require('./repo');
const { displayFirstLast, nameKey } = require('./names');
const { isMultiDay } = require('./sessionParts');

// Everyone who can be picked as a trainer - same definition as the Trainers page (routes/
// trainers.js): trainer-type profiles plus anyone who has taught a session, which covers a
// trainer merged into their own employee profile.
async function listTrainerProfiles() {
  return dbAll(
    `SELECT * FROM employees
     WHERE (client_id = ? AND employee_type = 'trainer')
        OR is_trainer = 1
        OR employee_id IN (SELECT trainer_employee_id FROM training_sessions WHERE trainer_employee_id IS NOT NULL)
        OR employee_id IN (SELECT assigned_trainer_employee_id FROM session_days WHERE assigned_trainer_employee_id IS NOT NULL)
        OR employee_id IN (SELECT signed_trainer_employee_id FROM session_days WHERE signed_trainer_employee_id IS NOT NULL)
        OR employee_id IN (SELECT trainer_employee_id FROM session_co_trainers WHERE trainer_employee_id IS NOT NULL)`,
    [repo.INTERNAL_CLIENT_ID]
  );
}

// A typed trainer name -> that trainer's profile id: an existing trainer with the same name
// (first/last compared, so "Kasey Hilton" matches "Hilton, Kasey"), otherwise a new trainer
// profile, the same way a session's main trainer is created.
async function resolveTrainerByName(name, phone = null) {
  const key = nameKey(name);
  if (!key) return null;
  const match = (await listTrainerProfiles()).find((e) => nameKey(e.full_name) === key);
  return match ? match.employee_id : repo.findOrCreateTrainerEmployee(name, phone);
}

function trainerDisplayName(employee) {
  return employee ? displayFirstLast(employee) : null;
}

// `dayTrainers`: one entry per day - a trainer's employee_id, or null/'' for "same as the
// session's trainer". Rewrites the assignments for days 1..total_days (sign-offs already recorded
// are kept) and drops rows past the last day if the course got shorter.
async function saveDayTrainers(session, dayTrainers) {
  if (!isMultiDay(session)) {
    await dbRun('DELETE FROM session_days WHERE session_id = ?', [session.session_id]);
    return;
  }
  const list = Array.isArray(dayTrainers) ? dayTrainers : [];
  for (let day = 1; day <= session.total_days; day += 1) {
    const chosenId = list[day - 1] || null;
    // eslint-disable-next-line no-await-in-loop
    const chosen = chosenId ? await dbGet('SELECT * FROM employees WHERE employee_id = ?', [chosenId]) : null;
    const trainerId = chosen ? chosen.employee_id : session.trainer_employee_id || null;
    const trainerName = chosen ? trainerDisplayName(chosen) : session.trainer_name;
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `INSERT INTO session_days (id, session_id, day_number, assigned_trainer_name, assigned_trainer_employee_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (session_id, day_number) DO UPDATE
         SET assigned_trainer_name = EXCLUDED.assigned_trainer_name,
             assigned_trainer_employee_id = EXCLUDED.assigned_trainer_employee_id`,
      [uuidv4(), session.session_id, day, trainerName, trainerId]
    );
  }
  await dbRun('DELETE FROM session_days WHERE session_id = ? AND day_number > ?', [session.session_id, session.total_days]);
}

// Every day of a multi-day session, 1..total_days, filled in even where no row exists yet (e.g.
// sessions created before per-day trainers existed): scheduled date, assigned trainer, and the
// sign-off if there is one. Empty for a single-day session and a Multi Training Day (one day).
async function getSessionDays(session) {
  if (!isMultiDay(session)) return [];
  const rows = await dbAll('SELECT * FROM session_days WHERE session_id = ? ORDER BY day_number', [session.session_id]);
  const byDay = new Map(rows.map((r) => [r.day_number, r]));
  const dates = session.day_dates ? (typeof session.day_dates === 'string' ? JSON.parse(session.day_dates) : session.day_dates) : [];
  return Array.from({ length: session.total_days }, (_, i) => {
    const day = i + 1;
    const row = byDay.get(day) || {};
    return {
      day_number: day,
      date: dates[i] || (day === 1 ? session.session_date : null),
      assigned_trainer_name: row.assigned_trainer_name || session.trainer_name,
      assigned_trainer_employee_id: row.assigned_trainer_employee_id || (row.id ? null : session.trainer_employee_id) || null,
      signed_trainer_name: row.signed_trainer_name || null,
      signed_trainer_employee_id: row.signed_trainer_employee_id || null,
      signed_trainer_email: row.signed_trainer_email || null,
      signature: row.signature || null,
      signed_at: row.signed_at || null,
      reminder_sent_at: row.reminder_sent_at || null,
    };
  });
}

// The trainer's day sign-off - also used for the final day by the close-out itself.
async function recordDaySignoff(session, day, { name, employeeId, email, phone, signature }) {
  await dbRun(
    `INSERT INTO session_days (id, session_id, day_number, assigned_trainer_name, assigned_trainer_employee_id,
                               signed_trainer_name, signed_trainer_employee_id, signed_trainer_email, signed_trainer_phone, signature, signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now_utc_text())
     ON CONFLICT (session_id, day_number) DO UPDATE
       SET signed_trainer_name = EXCLUDED.signed_trainer_name,
           signed_trainer_employee_id = EXCLUDED.signed_trainer_employee_id,
           signed_trainer_email = EXCLUDED.signed_trainer_email,
           signed_trainer_phone = EXCLUDED.signed_trainer_phone,
           signature = EXCLUDED.signature,
           signed_at = EXCLUDED.signed_at`,
    [uuidv4(), session.session_id, day, session.trainer_name, session.trainer_employee_id || null, name, employeeId || null, email || null, phone || null, signature]
  );
}

async function clearDaySignoff(sessionId, day) {
  await dbRun(
    `UPDATE session_days
     SET signed_trainer_name = NULL, signed_trainer_employee_id = NULL, signed_trainer_email = NULL,
         signed_trainer_phone = NULL, signature = NULL, signed_at = NULL, reminder_sent_at = NULL
     WHERE session_id = ? AND day_number = ?`,
    [sessionId, day]
  );
}

// The other trainers teaching alongside the lead trainer on every day (migration 074, Keeley's
// request, 2026-10-01), in the order they were added.
async function getCoTrainers(sessionId) {
  return dbAll('SELECT * FROM session_co_trainers WHERE session_id = ? ORDER BY display_order, trainer_name', [sessionId]);
}

// `trainerIds`: the co-trainers' employee ids, in order. Replaces the session's list; the lead
// trainer and repeats are skipped.
async function saveCoTrainers(session, trainerIds) {
  await dbRun('DELETE FROM session_co_trainers WHERE session_id = ?', [session.session_id]);
  const seen = new Set([session.trainer_employee_id].filter(Boolean));
  let order = 0;
  for (const id of Array.isArray(trainerIds) ? trainerIds : []) {
    if (!id || seen.has(id)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const trainer = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [id]);
    if (!trainer) continue; // eslint-disable-line no-continue
    seen.add(id);
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      'INSERT INTO session_co_trainers (id, session_id, trainer_name, trainer_employee_id, display_order) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), session.session_id, trainerDisplayName(trainer), id, order]
    );
    order += 1;
  }
}

function uniqueNames(names) {
  const seen = new Set();
  return names.filter((n) => {
    const key = nameKey(n);
    if (!n || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "Bob Lathan", "Bob Lathan & Kasey Hilton", "Bob Lathan, Kasey Hilton & Guy Raymond".
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// A single-day session's trainers. With only a lead trainer, whoever signed the close-out stands in
// for them, as it always has. With co-trainers, any of them may close out (2026-10-01), so the
// lead stays listed - under their signed name when they closed it themselves - then the
// co-trainers, then whoever closed if they're none of those.
function singleDayTrainerNames(session, coNames) {
  const signer = session.trainer_signed_name;
  if (!coNames.length) return [signer || session.trainer_name];
  if (!signer) return [session.trainer_name, ...coNames];
  if (nameKey(signer) === nameKey(session.trainer_name)) return [signer, ...coNames];
  return [session.trainer_name, ...coNames, signer];
}

// Every trainer who taught the session, without repeats ("Bob Lathan, Kasey Hilton") - for the
// roster and email: each day's trainer in day order (whoever actually signed a day counts over
// whoever was assigned) then the co-trainers, or for a single day the lead and co-trainers.
async function allTrainerNames(session) {
  const days = await getSessionDays(session);
  const co = (await getCoTrainers(session.session_id)).map((t) => t.trainer_name);
  const names = days.length
    ? [...days.map((d) => d.signed_trainer_name || d.assigned_trainer_name), ...co]
    : singleDayTrainerNames(session, co);
  return uniqueNames(names).join(', ');
}

// Everyone who taught the session as {key, name, employee_id} - the lead trainer, each day's
// trainer (assigned and whoever signed), and the co-trainers. Feedback rates each of them, and
// the close-out offers each of them. `key` is stable for a trainer with or without a profile.
async function sessionTrainers(session) {
  const days = await getSessionDays(session);
  const candidates = [
    { name: session.trainer_name, employee_id: session.trainer_employee_id },
    ...days.flatMap((d) => [
      { name: d.assigned_trainer_name, employee_id: d.assigned_trainer_employee_id },
      { name: d.signed_trainer_name, employee_id: d.signed_trainer_employee_id },
    ]),
    ...(await getCoTrainers(session.session_id)).map((t) => ({ name: t.trainer_name, employee_id: t.trainer_employee_id })),
  ];
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!c.name) continue; // eslint-disable-line no-continue
    const nk = nameKey(c.name);
    const key = c.employee_id || `name:${nk}`;
    if (seen.has(key) || seen.has(`name:${nk}`)) continue; // eslint-disable-line no-continue
    seen.add(key);
    seen.add(`name:${nk}`);
    out.push({ key, name: c.name, employee_id: c.employee_id || null });
  }
  return out;
}

// The trainer(s) printed on each attendee's certificate: on a multi-day course, whoever taught the
// most days, and on a tie (e.g. one day each) the final day's trainer (Keeley's call, 2026-09-29);
// otherwise the lead trainer. Co-trainers are added after them - every trainer's name goes on the
// certificate (Keeley's call, 2026-10-01).
async function certificateTrainerName(session) {
  const co = (await getCoTrainers(session.session_id)).map((t) => t.trainer_name);
  if (!isMultiDay(session)) return joinNames(uniqueNames(singleDayTrainerNames(session, co)));
  return joinNames(uniqueNames([await mainCertificateTrainer(session), ...co]));
}

async function mainCertificateTrainer(session) {
  const days = await getSessionDays(session);
  if (!days.length) return session.trainer_signed_name || session.trainer_name;
  const counts = new Map();
  days.forEach((d) => {
    const name = d.signed_trainer_name || d.assigned_trainer_name;
    const key = nameKey(name);
    if (!key) return;
    const entry = counts.get(key) || { name, count: 0, lastDay: 0 };
    entry.count += 1;
    entry.lastDay = d.day_number;
    counts.set(key, entry);
  });
  const best = [...counts.values()].sort((a, b) => b.count - a.count || b.lastDay - a.lastDay)[0];
  return best ? best.name : session.trainer_signed_name || session.trainer_name;
}

// The session as certificate/roster generation should see it: all trainers' names, plus the
// day-by-day sign-offs for the roster.
async function withDayTrainers(session) {
  const hasCoTrainers = Boolean(await dbGet('SELECT 1 AS x FROM session_co_trainers WHERE session_id = ? LIMIT 1', [session.session_id]));
  if (!isMultiDay(session) && !hasCoTrainers) return session;
  return {
    ...session,
    certificate_trainer_name: await certificateTrainerName(session),
    all_trainer_names: await allTrainerNames(session),
    session_days: await getSessionDays(session),
  };
}

module.exports = {
  listTrainerProfiles, resolveTrainerByName, saveDayTrainers, getSessionDays, recordDaySignoff, clearDaySignoff,
  allTrainerNames, certificateTrainerName, withDayTrainers, getCoTrainers, saveCoTrainers, sessionTrainers, joinNames,
};
