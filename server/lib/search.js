// Name search used by every search box (Keeley's request, 2026-10-01: a search only worked when
// typed exactly "Last, First" - it should find the person however their name is typed). The
// typed text is split into words, and a row matches when every word appears somewhere in the
// name, in any order - "john smith", "smith john", "Smith, John" and "smi jo" all find
// "Smith, John". Case and accents are ignored ("jose" finds "José"). client/src/lib/search.js
// applies the same rule to lists filtered in the browser.
const ACCENTED = 'áàâäãåéèêëíìîïóòôöõúùûüñçý';
const PLAIN = 'aaaaaaeeeeiiiiooooouuuuncy';

function searchTokens(query) {
  return String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^a-z0-9'-]/g, ''))
    .filter(Boolean);
}

// SQL condition + params matching `column` against every word of `query`; null when nothing
// searchable was typed. `column` is a trusted column expression, never user input.
function nameSearchClause(column, query) {
  const tokens = searchTokens(query);
  if (!tokens.length) return null;
  return {
    sql: `(${tokens.map(() => `translate(LOWER(${column}), '${ACCENTED}', '${PLAIN}') LIKE ?`).join(' AND ')})`,
    params: tokens.map((t) => `%${t}%`),
  };
}

module.exports = { searchTokens, nameSearchClause };
