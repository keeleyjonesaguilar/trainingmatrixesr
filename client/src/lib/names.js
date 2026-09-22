// Client-side twin of server/lib/names.js - names are entered as separate first/last and shown
// by the system as "Last, First" (full_name) in lists or "First Last" where written out.

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Splits one combined name: "Last, First" on the comma, otherwise first word = first name.
export function parseName(raw) {
  const text = clean(raw);
  if (!text) return { first: '', last: '' };
  if (text.includes(',')) {
    const parts = text.split(',').map(clean).filter(Boolean);
    if (parts.length >= 3 && /^(jr|sr|ii|iii|iv|v)\.?$/i.test(parts[1])) {
      return { first: parts.slice(2).join(' '), last: `${parts[0]} ${parts[1]}` };
    }
    return { first: parts.slice(1).join(' '), last: parts[0] || '' };
  }
  const words = text.split(' ');
  return { first: words[0], last: words.slice(1).join(' ') };
}

export function formatFullName(first, last) {
  const f = clean(first);
  const l = clean(last);
  return f && l ? `${l}, ${f}` : l || f;
}

// An employee/trainer row's { first, last } - its own columns, or parsed from full_name.
export function nameParts(person) {
  if (!person) return { first: '', last: '' };
  if (person.first_name || person.last_name) return { first: person.first_name || '', last: person.last_name || '' };
  return parseName(person.full_name);
}

// "Bill Zuniga" - for fields that print the name, like a session's trainer.
export function displayFirstLast(person) {
  const { first, last } = nameParts(person);
  return [first, last].filter(Boolean).join(' ');
}

// Case/format-insensitive key: "Bill Zuniga" and "Zuniga, Bill" compare equal.
export function nameKey(first, last) {
  return formatFullName(first, last).toLowerCase();
}
