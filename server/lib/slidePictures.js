// Real pictures of each slide for the Content page (migration 093, Keeley 2026-11-06: the slide
// cards "need to show the full slide"). Each deck version is sent once to the slide converter - a
// private Render service (esr-slide-pictures) running LibreOffice - which
// sends back a PDF with one page per slide, hidden slides included. The PDF is kept beside the deck
// and the page draws each card from its page.
//
// The converter is server/slide-converter/slide_converter.py (LibreOffice run directly - wrapped by
// Gotenberg it needed over 512 MB), set up on Render as described at the top of that file.
// SLIDE_CONVERTER_URL is its private address there: http://esr-slide-pictures:10000 Without it (a test computer) nothing is converted and the cards
// show the slide's biggest picture as before.
//
// One deck at a time - the converter has 512 MB, and a big deck takes it a minute or two.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { dbGet, dbAll, dbRun } = require('../db');
const { DATA_DIR } = require('./paths');
const { readDeck } = require('./pptxDeck');

const CONVERT_TIMEOUT_MS = 6 * 60 * 1000;

function converterUrl() {
  return (process.env.SLIDE_CONVERTER_URL || '').trim().replace(/\/$/, '');
}

function isConfigured() {
  return Boolean(converterUrl());
}

function removeRelative(relative) {
  if (relative) fs.rm(path.join(DATA_DIR, relative), { force: true }, () => {});
}

let queue = Promise.resolve();
const queued = new Set();

async function convert(deckId) {
  const deck = await dbGet('SELECT deck_id, file_path, preview_path FROM content_decks WHERE deck_id = ?', [deckId]);
  if (!deck || !deck.file_path) return;
  const file = path.join(DATA_DIR, deck.file_path);
  if (!fs.existsSync(file)) {
    await dbRun('UPDATE content_decks SET preview_status = ?, preview_error = ? WHERE deck_id = ?', ['failed', 'The PowerPoint file isn\'t on this server.', deckId]);
    return;
  }
  const relative = path.posix.join('decks', deckId, `slides-${Date.now()}.pdf`);
  const out = path.join(DATA_DIR, relative);
  try {
    const { slides } = await readDeck(file);
    // The deck as the request body; the PDF comes back with a page for every slide, hidden ones too.
    const res = await fetch(`${converterUrl()}/convert`, {
      method: 'POST',
      body: await fs.openAsBlob(file),
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`converter said ${res.status} ${(await res.text()).slice(0, 200)}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out));
    // Only keep it if the deck wasn't replaced meanwhile.
    const now = await dbGet('SELECT file_path, preview_path FROM content_decks WHERE deck_id = ?', [deckId]);
    if (!now || now.file_path !== deck.file_path) { removeRelative(relative); return; }
    await dbRun(
      `UPDATE content_decks SET preview_path = ?, preview_status = 'ready', preview_order = ?, preview_error = NULL, preview_made_at = now_utc_text()
       WHERE deck_id = ?`,
      [relative, JSON.stringify(slides.map((s) => s.part_name)), deckId]
    );
    if (now.preview_path && now.preview_path !== relative) removeRelative(now.preview_path);
  } catch (err) {
    removeRelative(relative);
    console.error(`Slide pictures for deck ${deckId} failed:`, err.message); // eslint-disable-line no-console
    await dbRun('UPDATE content_decks SET preview_status = ?, preview_error = ? WHERE deck_id = ?', ['failed', String(err.message || err).slice(0, 300), deckId]);
  }
}

// Queues the deck's slide pictures to be made (after an upload, a new version, going back to the
// previous version, or Try again). The old pictures are dropped right away - they belong to the old file.
async function queueSlidePictures(deckId) {
  if (!isConfigured() || queued.has(deckId)) return;
  const deck = await dbGet('SELECT preview_path FROM content_decks WHERE deck_id = ?', [deckId]);
  if (!deck) return;
  await dbRun('UPDATE content_decks SET preview_status = ?, preview_error = NULL, preview_path = NULL, preview_order = NULL WHERE deck_id = ?', ['pending', deckId]);
  removeRelative(deck.preview_path);
  queued.add(deckId);
  queue = queue.then(() => convert(deckId)).catch(() => {}).finally(() => queued.delete(deckId));
}

// On start-up: decks that never got pictures (uploaded before this, or the server restarted
// part-way) are queued, oldest first.
async function queueMissingSlidePictures() {
  if (!isConfigured()) return;
  const decks = await dbAll("SELECT deck_id FROM content_decks WHERE preview_status IS NULL OR preview_status = 'pending' ORDER BY created_at");
  for (const d of decks) await queueSlidePictures(d.deck_id); // eslint-disable-line no-await-in-loop
}

function previewFile(deck) {
  if (!deck || deck.preview_status !== 'ready' || !deck.preview_path) return null;
  const file = path.join(DATA_DIR, deck.preview_path);
  return fs.existsSync(file) ? file : null;
}

module.exports = { isConfigured, queueSlidePictures, queueMissingSlidePictures, previewFile };
