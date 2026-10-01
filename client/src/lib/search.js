// Same matching rule as server/lib/search.js, for lists filtered in the browser (Keeley's
// request, 2026-10-01): every typed word must appear somewhere in the text, in any order, ignoring
// case, commas and accents - "john smith" finds "Smith, John", "jose" finds "José".
export function searchTokens(query) {
  return String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^a-z0-9'-]/g, ''))
    .filter(Boolean);
}

export function matchesSearch(text, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return tokens.every((t) => haystack.includes(t));
}
