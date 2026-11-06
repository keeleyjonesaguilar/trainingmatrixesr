// Which PowerPoints a class uses, and building a class's copy of each (migration 091, Keeley's
// "Training matrix features 11.6", 2026-11-06 - these replace the WeTransfer links).
//
// Every training type can have a deck (Content page). A class gets:
//   - one-day class: its training's deck (and each extra training's deck, in order)
//   - Multi Training Day: each training's deck, in check-in order
//   - multi-day course (OSHA 10/30): per day, the PowerPoints picked for that day on the Training
//     Type page (default_day_decks, migration 092; a course saved before uses its older per-day
//     training type topics, default_day_topics) - or the course's own deck when a day has none
// The class's copy of a deck gets a Sign-In QR slide first and a Feedback QR slide last, so the
// office never edits a deck per class (Keeley: "simple and fail proof"):
//   - Sign-In: the first deck of the class / of each day / of each training on a Multi Training Day
//     (attendees check in again at each one)
//   - Feedback: the last deck of the class - on a multi-day course, the last deck of EACH day, so
//     attendees rate that day's trainer before they leave (Keeley, 2026-11-06; the feedback form
//     starts on the current class day)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dbGet, dbAll, dbRun } = require('../db');
const { DATA_DIR } = require('./paths');
const { isMultiDay, isMultiTrainingDay, trainingParts } = require('./sessionParts');
const { stripTrainingIdPrefix } = require('./certificateFilename');
const { qrPngBuffer, feedbackQrPngBuffer } = require('./qr');
const { labeledQrPng } = require('./qrLabel');
const { writeDeck } = require('./pptxDeck');

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function deckFilePath(relative) {
  return relative ? path.join(DATA_DIR, relative) : null;
}

// Whether the deck's file is on this server. A deck uploaded while testing on another computer
// has its row in the shared database but its file only on that computer.
function deckFileExists(deck) {
  const file = deckFilePath(deck && deck.file_path);
  return Boolean(file && fs.existsSync(file));
}

// The random key in a class's download links - made the first time it's needed.
async function ensureFilesToken(session) {
  if (session.files_token) return session.files_token;
  const token = crypto.randomBytes(18).toString('base64url');
  await dbRun('UPDATE training_sessions SET files_token = ? WHERE session_id = ? AND files_token IS NULL', [token, session.session_id]);
  const row = await dbGet('SELECT files_token FROM training_sessions WHERE session_id = ?', [session.session_id]);
  session.files_token = row.files_token; // eslint-disable-line no-param-reassign
  return row.files_token;
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://esr-training.com').replace(/\/$/, '');
}

// The class's PowerPoints, grouped by day (one group with day null for a one-day class):
//   { groups: [{ day, items: [{ key, label, deck_id, deck_name, available, signIn, feedback }] }] }
// `available` is false when the training type has no deck yet or its file isn't on this server -
// those still show, so a missing PowerPoint is noticed before class rather than at it.
async function classPowerpoints(session) {
  if (!session || session.session_kind === 'toolbox_talk') return { groups: [] };
  const trainingsById = new Map((await dbAll('SELECT training_id, training_name, deck_id, default_day_topics, default_day_decks FROM master_trainings')).map((t) => [t.training_id, t]));
  const decksById = new Map((await dbAll('SELECT deck_id, name, file_path FROM content_decks')).map((d) => [d.deck_id, d]));

  const itemFor = (trainingId, fallbackLabel) => {
    const training = trainingId ? trainingsById.get(trainingId) : null;
    const deck = training && training.deck_id ? decksById.get(training.deck_id) : null;
    return {
      label: stripTrainingIdPrefix(training ? training.training_name : fallbackLabel || ''),
      training_id: trainingId || null,
      deck_id: deck ? deck.deck_id : null,
      deck_name: deck ? deck.name : null,
      available: Boolean(deck && deckFileExists(deck)),
      missing_reason: !deck ? 'No PowerPoint set up for this training yet' : !deckFileExists(deck) ? 'The PowerPoint file needs to be uploaded again' : null,
      fix_path: deck ? `/content/${deck.deck_id}` : '/content',
    };
  };
  // A deck picked straight for a day of a multi-day course.
  const deckItem = (deckId) => {
    const deck = decksById.get(deckId);
    return {
      label: deck.name,
      training_id: null,
      deck_id: deck.deck_id,
      deck_name: deck.name,
      available: deckFileExists(deck),
      missing_reason: deckFileExists(deck) ? null : 'The PowerPoint file needs to be uploaded again',
      fix_path: `/content/${deck.deck_id}`,
    };
  };
  // The same deck twice in a row (two trainings sharing one deck) is only downloaded once.
  const dedupe = (items) => items.filter((it, i) => !it.deck_id || items.findIndex((o) => o.deck_id === it.deck_id) === i);

  let groups;
  if (isMultiDay(session)) {
    const course = trainingsById.get(session.master_training_id);
    const dayDecks = parseJson(course && course.default_day_decks);
    const topics = parseJson(course && course.default_day_topics) || [];
    groups = Array.from({ length: session.total_days }, (_, i) => {
      let items;
      if (Array.isArray(dayDecks)) {
        items = dedupe((Array.isArray(dayDecks[i]) ? dayDecks[i] : []).filter((id) => decksById.has(id)).map(deckItem));
      } else {
        const dayTopics = (Array.isArray(topics[i]) ? topics[i] : []).filter((id) => trainingsById.has(id));
        items = dedupe(dayTopics.map((id) => itemFor(id)));
      }
      if (!items.length && course && course.deck_id && decksById.has(course.deck_id)) items = [deckItem(course.deck_id)];
      if (!items.length) {
        items = [{
          label: `Day ${i + 1} PowerPoint`,
          training_id: null,
          deck_id: null,
          deck_name: null,
          available: false,
          missing_reason: 'No PowerPoint chosen for this day yet',
          fix_path: `/training-types/${session.master_training_id}`,
        }];
      }
      return { day: i + 1, items };
    });
  } else if (isMultiTrainingDay(session)) {
    // Each training on its own check-in - so each one opens with the Sign-In slide.
    const parts = await trainingParts(session);
    groups = [{ day: null, items: parts.map((p) => ({ ...itemFor(p.master_training_id, p.label), signInEach: true })) }];
  } else {
    const parts = await trainingParts(session);
    groups = [{ day: null, items: dedupe(parts.map((p) => itemFor(p.master_training_id, p.label))) }];
  }

  // Where the QR slides go: only on decks that can actually be downloaded.
  groups.forEach((g, gi) => {
    const ready = g.items.filter((it) => it.available);
    g.items.forEach((it, i) => {
      it.key = `${g.day || 0}-${i + 1}`; // eslint-disable-line no-param-reassign
      it.signIn = it.available && (it.signInEach || it === ready[0]); // eslint-disable-line no-param-reassign
      it.feedback = it.available && (g.day || gi === groups.length - 1) && it === ready[ready.length - 1]; // eslint-disable-line no-param-reassign
      delete it.signInEach; // eslint-disable-line no-param-reassign
    });
  });
  return { groups };
}

// The same, with each available deck's download link filled in (class summary email, Training
// Portal, session page).
async function classPowerpointsWithLinks(session) {
  const plan = await classPowerpoints(session);
  if (plan.groups.some((g) => g.items.some((it) => it.available))) {
    const token = await ensureFilesToken(session);
    plan.groups.forEach((g) => g.items.forEach((it) => {
      if (!it.available) return;
      it.path = `/api/class-files/${token}/${it.key}`; // eslint-disable-line no-param-reassign
      it.url = `${publicBaseUrl()}${it.path}`; // eslint-disable-line no-param-reassign
    }));
  }
  return plan;
}

// A deck's slide order and settings, ready for writeDeck.
async function deckBuildOptions(deckId) {
  const slides = await dbAll('SELECT part_name, hidden, transition FROM content_deck_slides WHERE deck_id = ? ORDER BY position', [deckId]);
  return {
    order: slides.map((s) => s.part_name),
    settings: new Map(slides.map((s) => [s.part_name, { hidden: Number(s.hidden) === 1, transition: s.transition || null }])),
  };
}

function safeFilename(text) {
  return String(text || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'PowerPoint';
}

function longDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// A few downloads at once at most - each one streams a whole deck through the server.
let building = 0;
const MAX_BUILDING = 3;

// Runs one download build. Once the file has started going out there's no way to send an error
// message any more, so a failure part-way just cuts the download off (the browser shows it failed).
async function buildInto(res, build) {
  building += 1;
  try {
    await build();
  } catch (err) {
    if (!res.headersSent) throw err;
    console.error('PowerPoint download failed part-way:', err.message); // eslint-disable-line no-console
    res.destroy(err);
  } finally {
    building -= 1;
  }
}

// Sends the class's copy of one of its decks (key from classPowerpoints) as a download.
async function sendClassDeck(session, key, res) {
  const plan = await classPowerpoints(session);
  let found = null;
  for (const g of plan.groups) {
    const it = g.items.find((x) => x.key === key);
    if (it) { found = { group: g, item: it }; break; }
  }
  if (!found || !found.item.available) return res.status(404).json({ error: 'This PowerPoint isn\'t available. Contact the ESR office.' });
  if (building >= MAX_BUILDING) return res.status(503).json({ error: 'A few PowerPoints are downloading right now - please try again in a minute.' });
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [found.item.deck_id]);
  const dayDates = parseJson(session.day_dates) || [];
  const date = found.group.day ? dayDates[found.group.day - 1] || (found.group.day === 1 ? session.session_date : null) : session.session_date;
  const qrSlides = [];
  if (found.item.signIn) {
    qrSlides.push({ where: 'start', kind: 'signin', png: labeledQrPng(await qrPngBuffer(session.qr_token), 'signin'), className: found.item.label, classDate: longDate(date), language: session.language });
  }
  if (found.item.feedback) {
    qrSlides.push({ where: 'end', kind: 'feedback', png: labeledQrPng(await feedbackQrPngBuffer(session.qr_token), 'feedback'), className: stripTrainingIdPrefix(session.training_type_label), classDate: longDate(date), language: session.language });
  }
  const name = [found.item.label, found.group.day ? `Day ${found.group.day}` : null, date].filter(Boolean).join(' - ');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(name).replace(/[^\x20-\x7e]/g, '_')}.pptx"; filename*=UTF-8''${encodeURIComponent(`${safeFilename(name)}.pptx`)}`);
  res.setHeader('Cache-Control', 'no-store');
  await buildInto(res, async () => writeDeck(deckFilePath(deck.file_path), { ...(await deckBuildOptions(deck.deck_id)), qrSlides }, res));
  return null;
}

// Sends a deck as the office set it up (order, hidden slides, transitions) - no QR slides.
async function sendPlainDeck(deck, res) {
  if (!deckFileExists(deck)) return res.status(404).json({ error: 'This PowerPoint file isn\'t on the server - upload it again.' });
  if (building >= MAX_BUILDING) return res.status(503).json({ error: 'A few PowerPoints are downloading right now - please try again in a minute.' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(deck.name).replace(/[^\x20-\x7e]/g, '_')}.pptx"; filename*=UTF-8''${encodeURIComponent(`${safeFilename(deck.name)}.pptx`)}`);
  res.setHeader('Cache-Control', 'no-store');
  await buildInto(res, async () => writeDeck(deckFilePath(deck.file_path), await deckBuildOptions(deck.deck_id), res));
  return null;
}

module.exports = { classPowerpoints, classPowerpointsWithLinks, sendClassDeck, sendPlainDeck, deckFilePath, deckFileExists, ensureFilesToken };
