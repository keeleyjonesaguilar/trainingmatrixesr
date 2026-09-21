// Normalizes a full name down to its sorted set of words - "Cesar Flores Rojas" and "Rojas,
// Cesar Flores" both become "cesar flores rojas", so they compare equal regardless of word order
// or comma placement. Deliberately just a word-set match, not a fuzzy/edit-distance one: it only
// catches the exact-same-words-reordered case, which is safe (won't match two different people
// who happen to share a first name) - see server/routes/import.js's employee-match review queue.
function normalizeNameForMatching(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

module.exports = { normalizeNameForMatching };
