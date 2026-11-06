// A multi-day course's PowerPoints per day (migration 092, 2026-11-06): one list of deck_ids per
// day. A course saved before then has per-day training type topics instead - each topic's own
// deck stands in (pass `trainings` so they can be looked up).
function parseList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function courseDayDecks(training, count, trainings = []) {
  const days = Number(count) || 0;
  const decks = parseList(training?.default_day_decks);
  if (decks) return Array.from({ length: days }, (_, i) => (Array.isArray(decks[i]) ? decks[i] : []));
  const topics = parseList(training?.default_day_topics) || [];
  const deckOf = (tid) => trainings.find((t) => t.training_id === tid)?.deck_id;
  return Array.from({ length: days }, (_, i) => (
    Array.isArray(topics[i]) ? [...new Set(topics[i].map(deckOf).filter(Boolean))] : []
  ));
}

// The day numbers (1-based) of a multi-day course with no PowerPoint - none picked for the day and
// no course PowerPoint to fall back on.
export function daysWithoutDecks(training, trainings = []) {
  const count = Number(training?.default_total_days) || 0;
  if (!count || training.deck_id) return [];
  return courseDayDecks(training, count, trainings)
    .map((ids, i) => (ids.length ? null : i + 1))
    .filter(Boolean);
}
