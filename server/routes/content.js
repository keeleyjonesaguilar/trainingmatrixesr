// The Content page (Setup menu) - the PowerPoint library (migration 091, Keeley's "Training matrix
// features 11.6", 2026-11-06). Admins upload the decks built in PowerPoint, then set each slide's
// order, hidden-in-slideshow, transition, label and "needs update" flag here; a training type
// points at its deck, and classes download it (lib/classPowerpoints.js). Anyone signed in can look;
// changes need an admin.
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { dbGet, dbAll, dbRun } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../lib/activityLog');
const { DATA_DIR } = require('../lib/paths');
const { readDeck, streamPart, TRANSITIONS, DeckError } = require('../lib/pptxDeck');
const { deckFilePath, deckFileExists, sendPlainDeck, classPowerpointsWithLinks } = require('../lib/classPowerpoints');
const slidePictures = require('../lib/slidePictures');

const router = express.Router();

const DECKS_DIR = path.join(DATA_DIR, 'decks');
const INCOMING_DIR = path.join(DECKS_DIR, 'incoming');
fs.mkdirSync(INCOMING_DIR, { recursive: true });
// Raised from 300 MB (Keeley 2026-11-13). Uploads stream to disk and decks are read one zip entry
// at a time, so size doesn't cost memory.
const MAX_MB = 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, INCOMING_DIR),
    filename: (req, file, cb) => cb(null, `${uuidv4()}.pptx`),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.ppt$/i.test(file.originalname)) return cb(new DeckError('This is an older .ppt file. Open it in PowerPoint, choose File > Save As > PowerPoint Presentation (.pptx), and upload that.'));
    if (!/\.pptx$/i.test(file.originalname)) return cb(new DeckError('Only PowerPoint files (.pptx) can be uploaded here.'));
    return cb(null, true);
  },
});

// multer's own errors (too big, wrong type) as a message the office can act on.
function receiveFile(req, res) {
  return new Promise((resolve) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return resolve(true);
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `This PowerPoint is over ${MAX_MB >= 1024 ? `${MAX_MB / 1024} GB` : `${MAX_MB} MB`}. Compress its pictures and videos in PowerPoint (File > Compress Media / Compress Pictures) and try again.`
        : err instanceof DeckError ? err.message : 'The upload didn\'t go through - please try again.';
      res.status(400).json({ error: message });
      return resolve(false);
    });
  });
}

function removeFile(relative) {
  const file = deckFilePath(relative);
  if (file) fs.rm(file, { force: true }, () => {});
}

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

// Puts a just-read deck's slides in place of the deck's current ones. Labels, flags and chosen
// transitions carry over to slides whose text is the same as before; the order is the new file's.
async function replaceSlides(deckId, slides) {
  const old = await dbAll('SELECT * FROM content_deck_slides WHERE deck_id = ? ORDER BY position', [deckId]);
  const unused = [...old];
  await dbRun('DELETE FROM content_deck_slides WHERE deck_id = ?', [deckId]);
  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i];
    const matchIndex = s.fingerprint ? unused.findIndex((o) => o.fingerprint === s.fingerprint) : -1;
    const prev = matchIndex >= 0 ? unused.splice(matchIndex, 1)[0] : null;
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `INSERT INTO content_deck_slides (id, deck_id, part_name, position, hidden, transition, file_transition, label, flagged, flag_note, flagged_by, flagged_at, title, body_text, notes_text, picture_part, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), deckId, s.part_name, i + 1, s.hidden, prev ? prev.transition : null, s.file_transition,
        prev ? prev.label : null, prev ? prev.flagged : 0, prev ? prev.flag_note : null, prev ? prev.flagged_by : null, prev ? prev.flagged_at : null,
        s.title, s.body_text, s.notes_text, s.picture_part, s.fingerprint,
      ]
    );
  }
  return { carried: old.length - unused.length };
}

// Reads an uploaded file and files it under the deck. Throws DeckError when it isn't a usable deck
// (the upload is deleted).
async function storeUpload(deckId, file) {
  let info;
  try {
    info = await readDeck(file.path);
  } catch (err) {
    fs.rm(file.path, { force: true }, () => {});
    throw err;
  }
  const dir = path.join(DECKS_DIR, deckId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.pptx`;
  fs.renameSync(file.path, path.join(dir, name));
  return { info, relative: path.posix.join('decks', deckId, name) };
}

async function usedBy(deckId) {
  return dbAll('SELECT training_id, training_name, active FROM master_trainings WHERE deck_id = ? ORDER BY training_name', [deckId]);
}

function parseList(value) {
  if (!value) return null;
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : null; } catch { return null; }
}

// Which multi-day courses use each deck on which days (default_day_decks, migration 092):
// Map deck_id -> [{ training_id, training_name, days: [1, 3] }].
async function dayUses() {
  const courses = await dbAll('SELECT training_id, training_name, default_day_decks FROM master_trainings WHERE default_day_decks IS NOT NULL ORDER BY training_name');
  const uses = new Map();
  courses.forEach((c) => {
    (parseList(c.default_day_decks) || []).forEach((ids, i) => {
      (Array.isArray(ids) ? ids : []).forEach((deckId) => {
        if (!uses.has(deckId)) uses.set(deckId, []);
        const list = uses.get(deckId);
        let entry = list.find((u) => u.training_id === c.training_id);
        if (!entry) { entry = { training_id: c.training_id, training_name: c.training_name, days: [] }; list.push(entry); }
        if (!entry.days.includes(i + 1)) entry.days.push(i + 1);
      });
    });
  });
  return uses;
}

async function setUsedBy(deckId, trainingIds) {
  const ids = Array.isArray(trainingIds) ? trainingIds.filter((id) => typeof id === 'string') : [];
  await dbRun('UPDATE master_trainings SET deck_id = NULL WHERE deck_id = ?', [deckId]);
  for (const id of ids) {
    await dbRun('UPDATE master_trainings SET deck_id = ? WHERE training_id = ?', [deckId, id]); // eslint-disable-line no-await-in-loop
  }
}

function deckSummary(deck, extra = {}) {
  return {
    deck_id: deck.deck_id,
    name: deck.name,
    notes: deck.notes,
    original_filename: deck.original_filename,
    file_size: deck.file_size != null ? Number(deck.file_size) : null,
    slide_width: deck.slide_width != null ? Number(deck.slide_width) : null,
    slide_height: deck.slide_height != null ? Number(deck.slide_height) : null,
    uploaded_at: deck.uploaded_at,
    uploaded_by: deck.uploaded_by,
    has_previous: Boolean(deck.previous_file_path),
    previous_uploaded_at: deck.previous_uploaded_at,
    previous_original_filename: deck.previous_original_filename,
    previous_file_size: deck.previous_file_size != null ? Number(deck.previous_file_size) : null,
    updated_at: deck.updated_at,
    file_missing: !deckFileExists(deck),
    // Real slide pictures (migration 093): 'ready', 'pending', 'failed', or 'off' where this server
    // has no slide converter (a test computer).
    pictures: !slidePictures.isConfigured() && deck.preview_status !== 'ready' ? 'off' : (deck.preview_status || 'pending'),
    pictures_error: deck.preview_status === 'failed' ? deck.preview_error : null,
    ...extra,
  };
}

function actorName(req) {
  return req.user ? (req.user.full_name || req.user.username) : null;
}

// The transitions the page offers.
router.get('/transitions', (req, res) => {
  res.json(Object.entries(TRANSITIONS).map(([value, t]) => ({ value, label: t.label })));
});

// Every deck, with its slide/flag counts and the training types using it.
router.get('/decks', async (req, res) => {
  const [decks, counts, links, days] = await Promise.all([
    dbAll('SELECT * FROM content_decks ORDER BY LOWER(name)'),
    dbAll(`SELECT deck_id, COUNT(*) AS slides, SUM(CASE WHEN flagged = 1 THEN 1 ELSE 0 END) AS flagged, SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden
           FROM content_deck_slides GROUP BY deck_id`),
    dbAll('SELECT training_id, training_name, deck_id FROM master_trainings WHERE deck_id IS NOT NULL ORDER BY training_name'),
    dayUses(),
  ]);
  const countBy = new Map(counts.map((c) => [c.deck_id, c]));
  res.json(decks.map((d) => deckSummary(d, {
    slide_count: Number(countBy.get(d.deck_id)?.slides || 0),
    flagged_count: Number(countBy.get(d.deck_id)?.flagged || 0),
    hidden_count: Number(countBy.get(d.deck_id)?.hidden || 0),
    used_by: links.filter((l) => l.deck_id === d.deck_id).map((l) => ({ training_id: l.training_id, training_name: l.training_name })),
    used_on_days: days.get(d.deck_id) || [],
  })));
});

// A new deck: the file, a name (defaults to the file's name), and the training types that use it.
router.post('/decks', requireAdmin, async (req, res) => {
  if (!(await receiveFile(req, res))) return;
  if (!req.file) return res.status(400).json({ error: 'Choose a PowerPoint (.pptx) to upload.' });
  const name = cleanText(req.body.name, 200) || path.basename(req.file.originalname, path.extname(req.file.originalname));
  const deckId = uuidv4();
  let stored;
  try {
    stored = await storeUpload(deckId, req.file);
  } catch (err) {
    if (err instanceof DeckError) return res.status(400).json({ error: err.message });
    throw err;
  }
  await dbRun(
    `INSERT INTO content_decks (deck_id, name, notes, file_path, original_filename, file_size, slide_width, slide_height, uploaded_at, uploaded_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, now_utc_text(), ?, now_utc_text())`,
    [deckId, name, cleanText(req.body.notes, 4000), stored.relative, req.file.originalname, req.file.size, stored.info.slideWidth, stored.info.slideHeight, actorName(req)]
  );
  await replaceSlides(deckId, stored.info.slides);
  let trainingIds = req.body.training_ids;
  if (typeof trainingIds === 'string') { try { trainingIds = JSON.parse(trainingIds); } catch { trainingIds = []; } }
  if (Array.isArray(trainingIds) && trainingIds.length) await setUsedBy(deckId, trainingIds);
  logActivity({ actor: req.user, action: 'content_deck_created', entityType: 'content_deck', entityId: deckId, entityLabel: name, details: `${stored.info.slides.length} slides`, req });
  await slidePictures.queueSlidePictures(deckId);
  return res.status(201).json({ deck_id: deckId });
});

// One deck with all its slides.
router.get('/decks/:id', async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  const slides = await dbAll(
    `SELECT id, part_name, position, hidden, transition, file_transition, label, flagged, flag_note, flagged_by, flagged_at, title, body_text, notes_text, picture_part IS NOT NULL AS has_picture
     FROM content_deck_slides WHERE deck_id = ? ORDER BY position`,
    [deck.deck_id]
  );
  res.json(deckSummary(deck, {
    slides: slides.map((s) => ({ ...s, has_picture: Boolean(s.has_picture), hidden: Number(s.hidden) === 1, flagged: Number(s.flagged) === 1 })),
    used_by: await usedBy(deck.deck_id),
    used_on_days: (await dayUses()).get(deck.deck_id) || [],
    pictures_order: deck.preview_status === 'ready' ? JSON.parse(deck.preview_order || '[]') : null,
  }));
});

// The deck's slide pictures as one PDF, a page per slide (migration 093) - the page draws each card from it.
router.get('/decks/:id/slides.pdf', async (req, res) => {
  const deck = await dbGet('SELECT deck_id, preview_status, preview_path FROM content_decks WHERE deck_id = ?', [req.params.id]);
  const file = slidePictures.previewFile(deck);
  if (!file) return res.status(404).json({ error: 'The slide pictures aren\'t ready.' });
  res.set('Cache-Control', 'private, max-age=86400');
  return res.sendFile(file, { headers: { 'Content-Type': 'application/pdf' } });
});

// Make the slide pictures again (after a failure).
router.post('/decks/:id/slides-pictures', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT deck_id FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  if (!slidePictures.isConfigured()) return res.status(400).json({ error: 'Slide pictures are only made on the live site.' });
  await slidePictures.queueSlidePictures(deck.deck_id);
  return res.json({ ok: true });
});

// Name, notes, and which training types use it.
router.put('/decks/:id', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
  const name = has('name') ? cleanText(req.body.name, 200) : deck.name;
  if (!name) return res.status(400).json({ error: 'Give the PowerPoint a name.' });
  const notes = has('notes') ? cleanText(req.body.notes, 4000) : deck.notes;
  await dbRun('UPDATE content_decks SET name = ?, notes = ?, updated_at = now_utc_text() WHERE deck_id = ?', [name, notes, deck.deck_id]);
  if (has('training_ids')) await setUsedBy(deck.deck_id, req.body.training_ids);
  logActivity({ actor: req.user, action: 'content_deck_updated', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: name, req });
  res.json({ ok: true });
});

// The slides' order and settings, saved all at once: [{ id, hidden, transition, label, flagged,
// flag_note }] in the new order.
router.put('/decks/:id/slides', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT deck_id, name FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  const list = Array.isArray(req.body.slides) ? req.body.slides : null;
  const existing = await dbAll('SELECT * FROM content_deck_slides WHERE deck_id = ?', [deck.deck_id]);
  const byId = new Map(existing.map((s) => [s.id, s]));
  if (!list || list.length !== existing.length || list.some((s) => !byId.has(s.id)) || new Set(list.map((s) => s.id)).size !== list.length) {
    return res.status(409).json({ error: 'This PowerPoint changed since you opened it - reload the page and try again.' });
  }
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    const old = byId.get(s.id);
    const transition = s.transition && TRANSITIONS[s.transition] ? s.transition : null;
    const flagged = s.flagged ? 1 : 0;
    const flagNote = flagged ? cleanText(s.flag_note, 2000) : null;
    const newlyFlagged = flagged && (!Number(old.flagged) || flagNote !== old.flag_note);
    // eslint-disable-next-line no-await-in-loop
    await dbRun(
      `UPDATE content_deck_slides SET position = ?, hidden = ?, transition = ?, label = ?, flagged = ?, flag_note = ?, flagged_by = ?, flagged_at = ?
       WHERE id = ? AND deck_id = ?`,
      [
        i + 1, s.hidden ? 1 : 0, transition, cleanText(s.label, 200), flagged, flagNote,
        flagged ? (newlyFlagged ? actorName(req) : old.flagged_by) : null,
        flagged ? (newlyFlagged ? new Date().toISOString().slice(0, 19).replace('T', ' ') : old.flagged_at) : null,
        s.id, deck.deck_id,
      ]
    );
  }
  await dbRun('UPDATE content_decks SET updated_at = now_utc_text() WHERE deck_id = ?', [deck.deck_id]);
  logActivity({ actor: req.user, action: 'content_deck_slides_updated', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: deck.name, req });
  res.json({ ok: true });
});

// A slide's card picture.
router.get('/decks/:id/slides/:slideId/picture', async (req, res) => {
  const row = await dbGet(
    `SELECT s.picture_part, d.file_path FROM content_deck_slides s JOIN content_decks d ON d.deck_id = s.deck_id
     WHERE s.id = ? AND s.deck_id = ?`,
    [req.params.slideId, req.params.id]
  );
  if (!row || !row.picture_part || !deckFileExists(row)) return res.status(404).end();
  const ext = path.extname(row.picture_part).toLowerCase();
  res.setHeader('Content-Type', { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  const sent = await streamPart(deckFilePath(row.file_path), row.picture_part, res);
  if (!sent && !res.headersSent) res.status(404).end();
  return null;
});

// A new version of the deck's file. The current one is kept as "previous".
router.post('/decks/:id/file', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  if (!(await receiveFile(req, res))) return;
  if (!req.file) return res.status(400).json({ error: 'Choose a PowerPoint (.pptx) to upload.' });
  let stored;
  try {
    stored = await storeUpload(deck.deck_id, req.file);
  } catch (err) {
    if (err instanceof DeckError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (deck.previous_file_path) removeFile(deck.previous_file_path);
  const keepPrevious = deckFileExists(deck);
  await dbRun(
    `UPDATE content_decks SET file_path = ?, original_filename = ?, file_size = ?, slide_width = ?, slide_height = ?, uploaded_at = now_utc_text(), uploaded_by = ?,
       previous_file_path = ?, previous_original_filename = ?, previous_file_size = ?, previous_uploaded_at = ?, previous_uploaded_by = ?, updated_at = now_utc_text()
     WHERE deck_id = ?`,
    [
      stored.relative, req.file.originalname, req.file.size, stored.info.slideWidth, stored.info.slideHeight, actorName(req),
      keepPrevious ? deck.file_path : null, keepPrevious ? deck.original_filename : null, keepPrevious ? deck.file_size : null,
      keepPrevious ? deck.uploaded_at : null, keepPrevious ? deck.uploaded_by : null,
      deck.deck_id,
    ]
  );
  const { carried } = await replaceSlides(deck.deck_id, stored.info.slides);
  logActivity({ actor: req.user, action: 'content_deck_new_version', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: deck.name, details: `${stored.info.slides.length} slides`, req });
  await slidePictures.queueSlidePictures(deck.deck_id);
  return res.json({ ok: true, slides: stored.info.slides.length, carried });
});

// Back to the previous version (the current one becomes "previous", so this can be undone).
router.post('/decks/:id/restore-previous', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  const previous = { file_path: deck.previous_file_path };
  if (!deck.previous_file_path || !deckFileExists(previous)) return res.status(400).json({ error: 'There\'s no previous version of this PowerPoint on the server.' });
  let info;
  try {
    info = await readDeck(deckFilePath(deck.previous_file_path));
  } catch (err) {
    if (err instanceof DeckError) return res.status(400).json({ error: err.message });
    throw err;
  }
  await dbRun(
    `UPDATE content_decks SET file_path = ?, original_filename = ?, file_size = ?, uploaded_at = ?, uploaded_by = ?,
       previous_file_path = ?, previous_original_filename = ?, previous_file_size = ?, previous_uploaded_at = ?, previous_uploaded_by = ?,
       slide_width = ?, slide_height = ?, updated_at = now_utc_text()
     WHERE deck_id = ?`,
    [
      deck.previous_file_path, deck.previous_original_filename, deck.previous_file_size, deck.previous_uploaded_at, deck.previous_uploaded_by,
      deck.file_path, deck.original_filename, deck.file_size, deck.uploaded_at, deck.uploaded_by,
      info.slideWidth, info.slideHeight, deck.deck_id,
    ]
  );
  await replaceSlides(deck.deck_id, info.slides);
  logActivity({ actor: req.user, action: 'content_deck_restored_previous', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: deck.name, req });
  await slidePictures.queueSlidePictures(deck.deck_id);
  return res.json({ ok: true });
});

// Deletes the kept previous version to free disk space (the current version is untouched).
router.delete('/decks/:id/previous', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  if (!deck.previous_file_path) return res.status(400).json({ error: 'There\'s no previous version of this PowerPoint to remove.' });
  // Never delete the file the current version uses (shouldn't happen, but a shared path would lose it).
  if (deck.previous_file_path !== deck.file_path) removeFile(deck.previous_file_path);
  await dbRun(
    `UPDATE content_decks SET previous_file_path = NULL, previous_original_filename = NULL, previous_file_size = NULL,
       previous_uploaded_at = NULL, previous_uploaded_by = NULL, updated_at = now_utc_text()
     WHERE deck_id = ?`,
    [deck.deck_id]
  );
  logActivity({ actor: req.user, action: 'content_deck_previous_removed', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: deck.name, details: deck.previous_original_filename || null, req });
  return res.json({ ok: true });
});

// The deck as set up here (order, hidden slides, transitions) - no class QR slides.
router.get('/decks/:id/download', async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  return sendPlainDeck(deck, res);
});

// A class's PowerPoints with their download links, for the session page - the same ones its
// trainers get in the class summary email.
router.get('/sessions/:id/powerpoints', async (req, res) => {
  const session = await dbGet('SELECT * FROM training_sessions WHERE session_id = ?', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  return res.json(await classPowerpointsWithLinks(session));
});

router.delete('/decks/:id', requireAdmin, async (req, res) => {
  const deck = await dbGet('SELECT * FROM content_decks WHERE deck_id = ?', [req.params.id]);
  if (!deck) return res.status(404).json({ error: 'PowerPoint not found.' });
  await dbRun('UPDATE master_trainings SET deck_id = NULL WHERE deck_id = ?', [deck.deck_id]);
  // Off every multi-day course day that used it.
  const courses = await dbAll('SELECT training_id, default_day_decks FROM master_trainings WHERE default_day_decks IS NOT NULL');
  for (const c of courses) {
    const list = parseList(c.default_day_decks);
    if (!list || !list.some((ids) => Array.isArray(ids) && ids.includes(deck.deck_id))) continue; // eslint-disable-line no-continue
    const next = list.map((ids) => (Array.isArray(ids) ? ids.filter((id) => id !== deck.deck_id) : []));
    await dbRun('UPDATE master_trainings SET default_day_decks = ? WHERE training_id = ?', [next.some((ids) => ids.length) ? JSON.stringify(next) : null, c.training_id]); // eslint-disable-line no-await-in-loop
  }
  await dbRun('DELETE FROM content_decks WHERE deck_id = ?', [deck.deck_id]);
  // Only this server's files - never anything outside the deck's own folder.
  const dir = path.join(DECKS_DIR, deck.deck_id);
  if (path.dirname(dir) === DECKS_DIR) fs.rm(dir, { recursive: true, force: true }, () => {});
  logActivity({ actor: req.user, action: 'content_deck_deleted', entityType: 'content_deck', entityId: deck.deck_id, entityLabel: deck.name, req });
  res.status(204).end();
});

module.exports = router;
