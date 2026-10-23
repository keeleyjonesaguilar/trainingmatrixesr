// Public interest sign-up API (Keeley's request, 2026-10-23) - mounted at /api/register WITHOUT
// requireAuth. Anyone with a class's /register/<token> link can see the class and leave their
// details for the office to follow up. See server/lib/publicSignup.js.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun, withTransaction } = require('../db');
const { formatPhoneNumber, isValidPhoneNumber } = require('../lib/phone');
const { easternToday } = require('../lib/dates');
const { MAX_PEOPLE, classDays, trainingName, announceRegistration } = require('../lib/publicSignup');

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The link name, as typed - capitals still find a chosen name like "osha30" ("OSHA30").
async function getSessionByToken(token) {
  if (!token) return null;
  return (await dbGet('SELECT * FROM training_sessions WHERE public_signup_token = ?', [token]))
    || dbGet('SELECT * FROM training_sessions WHERE lower(public_signup_token) = lower(?)', [token]);
}

// Why the class isn't taking sign-ups, or null if it is. Sign-ups stay open through the first
// class day.
function closedReason(session) {
  if (!session.public_signup_open || session.status === 'closed') return 'Sign-up for this class is closed.';
  if (classDays(session)[0] < easternToday()) return 'This class has already started, so sign-up is closed.';
  return null;
}

router.get('/:token', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'This sign-up link is not valid. Please check the link and try again.' });
  res.json({
    training: trainingName(session),
    language: session.language || 'english',
    days: classDays(session),
    class_hours: session.public_class_hours || '',
    location: session.location || '',
    details: session.public_details || '',
    max_people: MAX_PEOPLE,
    closed_reason: closedReason(session),
  });
});

const clean = (value, max = 200) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function validate(body) {
  const contact = {
    first: clean(body.first_name, 80),
    last: clean(body.last_name, 80),
    email: clean(body.email, 200).toLowerCase(),
    phone: clean(body.phone, 40),
    company: clean(body.company, 200),
  };
  if (!contact.first || !contact.last) return { error: 'Please enter your first and last name.' };
  if (!EMAIL_PATTERN.test(contact.email)) return { error: 'Please enter a valid email address.' };
  if (!isValidPhoneNumber(contact.phone)) return { error: 'Please enter a standard 10-digit phone number.' };
  const list = Array.isArray(body.attendees) ? body.attendees : [];
  if (!list.length) return { error: 'Please choose how many people are interested.' };
  if (list.length > MAX_PEOPLE) return { error: `Please sign up ${MAX_PEOPLE} people or fewer at a time.` };
  // Each person's name is optional (Keeley, 2026-10-23: "we only technically need 1 POC") - the
  // list's length is how many are interested; only the names given are kept, in their order.
  const attendees = list
    .map((a, i) => ({ seat: i + 1, first: clean(a?.first_name, 80), last: clean(a?.last_name, 80) }))
    .filter((a) => a.first || a.last);
  return { contact, attendees, count: list.length };
}

router.post('/:token', async (req, res) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) return res.status(404).json({ error: 'This sign-up link is not valid.' });
  // Hidden "website" field - people never see it, form-filling bots fill it in. Looks like a
  // success so the bot moves on, but nothing is saved or emailed.
  if (clean(req.body?.website)) return res.json({ registration_id: null, seats: 0 });

  const parsed = validate(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { contact, attendees, count } = parsed;
  const reason = closedReason(session);
  if (reason) return res.status(409).json({ error: reason });

  const result = await withTransaction(async () => {
    // The same person pressing Submit twice (double tap, back button) within 10 minutes with the
    // same people - hand back the first sign-up rather than saving it again.
    const recent = await dbAll(
      `SELECT pr.registration_id, pr.seats,
         COALESCE((SELECT string_agg(lower(first_name || ' ' || last_name), '|' ORDER BY seat_number) FROM public_registration_attendees WHERE registration_id = pr.registration_id), '') AS names
       FROM public_registrations pr
       WHERE pr.session_id = ? AND lower(pr.contact_email) = ?
         AND pr.created_at >= to_char((now() AT TIME ZONE 'utc') - interval '10 minutes', 'YYYY-MM-DD HH24:MI:SS')`,
      [session.session_id, contact.email]
    );
    const names = attendees.map((a) => `${a.first} ${a.last}`.toLowerCase()).join('|');
    const repeat = recent.find((r) => Number(r.seats) === count && r.names === names);
    if (repeat) return { registrationId: repeat.registration_id, repeat: true };

    const registrationId = uuidv4();
    await dbRun(
      `INSERT INTO public_registrations
         (registration_id, session_id, contact_first_name, contact_last_name, contact_email, contact_phone, company, seats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [registrationId, session.session_id, contact.first, contact.last, contact.email, formatPhoneNumber(contact.phone), contact.company || null, count]
    );
    for (const a of attendees) {
      // eslint-disable-next-line no-await-in-loop
      await dbRun(
        'INSERT INTO public_registration_attendees (id, registration_id, seat_number, first_name, last_name) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), registrationId, a.seat, a.first, a.last]
      );
    }
    return { registrationId, repeat: false };
  });

  const registration = await dbGet('SELECT * FROM public_registrations WHERE registration_id = ?', [result.registrationId]);
  if (!result.repeat) {
    const saved = await dbAll('SELECT * FROM public_registration_attendees WHERE registration_id = ? ORDER BY seat_number', [result.registrationId]);
    // Emails go out after the reply, so the page confirms straight away.
    announceRegistration(session, registration, saved).catch((err) => console.error('Public sign-up announce failed:', err.message));
  }
  res.json({ registration_id: registration.registration_id, seats: registration.seats });
});

module.exports = router;
