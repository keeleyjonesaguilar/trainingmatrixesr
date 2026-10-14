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

const EASTERN_PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// An Eastern wall-clock time typed in a form ("2026-10-15T05:00", from <input type="datetime-local">)
// -> UTC "YYYY-MM-DD HH:MM:SS", the format now_utc_text() stores. Null if it isn't one.
function easternLocalToUtcText(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const offsetAt = (ms) => {
    const p = Object.fromEntries(EASTERN_PARTS_FORMAT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - ms;
  };
  // Twice, so a time near a daylight-saving switch lands on the right side of it.
  let utc = asUtc - offsetAt(asUtc);
  utc = asUtc - offsetAt(utc);
  return new Date(utc).toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = { EASTERN_TZ, parseTimestamp, easternToday, easternLocalToUtcText };
