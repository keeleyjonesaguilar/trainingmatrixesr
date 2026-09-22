// Employee/trainer names are stored as separate first_name/last_name (Keeley's request,
// 2026-09-22: names had been typed as one "Last, First" string, so the comma was part of the data
// rather than how the system shows it). full_name is still kept on every row - always derived
// from the two parts, never typed - as the "Last, First" display/sort string the rest of the app
// (lists, search, duplicate checks, ORDER BY) already reads.
const { dbAll, dbRun } = require('../db');

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Best-effort split of a single typed/imported name into parts - only used where a source gives
// one combined string (an old record, a spreadsheet cell, a free-text trainer field). "Last,
// First" is split on the comma ("Daniels, Jr, Foy" keeps the suffix with the surname); a name
// with no comma is "First Last", first word = first name, the rest = last name (which keeps
// double surnames like "Flores Rojas" together).
function parseName(raw) {
  const text = clean(raw);
  if (!text) return { first: '', last: '' };
  if (text.includes(',')) {
    const parts = text.split(',').map(clean).filter(Boolean);
    if (parts.length >= 3 && SUFFIX.test(parts[1])) {
      return { first: parts.slice(2).join(' '), last: `${parts[0]} ${parts[1]}` };
    }
    return { first: parts.slice(1).join(' '), last: parts[0] || '' };
  }
  const words = text.split(' ');
  return { first: words[0], last: words.slice(1).join(' ') };
}

function formatFullName(first, last) {
  const f = clean(first);
  const l = clean(last);
  return f && l ? `${l}, ${f}` : l || f;
}

function firstLast(first, last) {
  return [clean(first), clean(last)].filter(Boolean).join(' ');
}

// "Bill Zuniga" for an employee row - for certificates, emails, and anywhere a name is written
// out rather than listed. Falls back to parsing full_name for a row not yet backfilled.
function displayFirstLast(employee) {
  if (!employee) return '';
  if (employee.first_name || employee.last_name) return firstLast(employee.first_name, employee.last_name);
  const { first, last } = parseName(employee.full_name);
  return firstLast(first, last);
}

// Resolves whatever a caller sent - explicit first/last, or only a combined full_name - into all
// three stored columns.
function nameColumns({ first_name, last_name, full_name } = {}) {
  let first = clean(first_name);
  let last = clean(last_name);
  if (!first && !last) ({ first, last } = parseName(full_name));
  return { first_name: first, last_name: last, full_name: formatFullName(first, last) };
}

// Lowercased canonical key for exact-name lookups - "Bill Zuniga", "Zuniga, Bill" and
// "zuniga,  bill" all compare equal to a stored full_name of "Zuniga, Bill".
function nameKey(rawOrParts) {
  const { first_name, full_name } = nameColumns(typeof rawOrParts === 'string' ? { full_name: rawOrParts } : rawOrParts);
  return (full_name || first_name).toLowerCase();
}

// One-time fill for rows created before first_name/last_name existed (and any row an older
// deploy created afterward) - runs at startup after migrations, only touches rows still missing
// both parts, and also normalizes their full_name to the derived "Last, First" form.
async function backfillEmployeeNameParts() {
  const rows = await dbAll(
    "SELECT employee_id, full_name FROM employees WHERE COALESCE(first_name, '') = '' AND COALESCE(last_name, '') = ''",
    []
  );
  for (const row of rows) {
    const cols = nameColumns({ full_name: row.full_name });
    // eslint-disable-next-line no-await-in-loop
    await dbRun('UPDATE employees SET first_name = ?, last_name = ?, full_name = ? WHERE employee_id = ?', [
      cols.first_name, cols.last_name, cols.full_name || row.full_name, row.employee_id,
    ]);
  }
  return rows.length;
}

module.exports = { parseName, formatFullName, firstLast, displayFirstLast, nameColumns, nameKey, backfillEmployeeNameParts };
