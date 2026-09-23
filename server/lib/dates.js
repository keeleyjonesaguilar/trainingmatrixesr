// Server mirror of client/src/lib/dates.js. The business runs on Eastern time, but Render's
// clock is UTC and the DB default now_utc_text() stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone
// marker - `new Date()` reads that as the machine's local time, so a local (Eastern) server would
// print roster times 4-5 hours off (Keeley's report, 2026-09-23).
const EASTERN_TZ = 'America/New_York';

const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
function parseTimestamp(value) {
  if (!value) return new Date(NaN);
  if (typeof value === 'string' && ZONELESS_DATETIME.test(value)) return new Date(`${value.replace(' ', 'T')}Z`);
  return new Date(value);
}

// Built once and reused: constructing an Intl.DateTimeFormat costs ~45us, and the status engine
// asks for today once per employee x training cell, which made the matrix seconds slower.
const EASTERN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ });

// Today's calendar date on Eastern time as "YYYY-MM-DD" - the UTC date rolls over at 8 PM Eastern.
function easternToday() {
  return EASTERN_DATE_FORMAT.format(new Date());
}

module.exports = { EASTERN_TZ, parseTimestamp, easternToday };
