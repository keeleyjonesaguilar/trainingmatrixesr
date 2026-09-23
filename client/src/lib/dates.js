// Every timestamp in this app (signed_at, created_at, attempted_at, etc.) is stored in UTC -
// displaying it pinned to Eastern (rather than the viewer's own machine timezone) means everyone
// sees the same business-standard time regardless of where they're logging in from (Keeley's
// request, 2026-09-17). Matches the equivalent fix in server/lib/pdfGen.js for certificates/rosters.
export const EASTERN_TZ = 'America/New_York';

// The DB default now_utc_text() stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker, and
// `new Date()` reads a zone-less datetime as the *browser's* local time - so every DB-stamped
// time (signed_at, created_at, submitted_at...) showed 4-5 hours late (Keeley's report,
// 2026-09-23). Tagging zone-less values as UTC fixes old and new rows alike; values that already
// carry a zone (JS toISOString's "Z", Postgres TIMESTAMPTZ) pass through untouched.
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
export function parseTimestamp(value) {
  if (!value) return new Date(NaN);
  if (typeof value === 'string' && ZONELESS_DATETIME.test(value)) return new Date(`${value.replace(' ', 'T')}Z`);
  return new Date(value);
}

// Built once and reused: constructing an Intl.DateTimeFormat costs ~45us per call (same fix as
// server/lib/dates.js, where it was called per matrix cell and slowed pages by seconds).
const EASTERN_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: EASTERN_TZ });

// Today's calendar date on Eastern time as "YYYY-MM-DD" - `new Date().toISOString()` is the UTC
// date, which rolls to tomorrow at 8 PM Eastern.
export function easternToday() {
  return EASTERN_DATE_FORMAT.format(new Date());
}

export function formatEasternDateTime(iso) {
  if (!iso) return '';
  const dt = parseTimestamp(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-US', { timeZone: EASTERN_TZ });
}

export function formatEasternDate(iso) {
  if (!iso) return '';
  const dt = parseTimestamp(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-US', { timeZone: EASTERN_TZ });
}

// Sequential calendar dates starting at `startDate`, one per day (Keeley's request, 2026-09-22) -
// a convenient starting point for a multi-day session's per-day date inputs; editable afterward
// to skip a weekend/holiday.
export function sequentialDates(startDate, count) {
  if (!startDate) return Array.from({ length: count }, () => '');
  const base = new Date(`${startDate}T00:00:00`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Plain "YYYY-MM-DD" -> "Sep 22" - for a multi-day session's per-day labels, which are wall-clock
// dates with no time/timezone component (unlike the UTC timestamps formatEasternDate* above
// handle), so this deliberately does its own parsing instead of going through `new Date(iso)`.
export function formatShortDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!match) return '';
  const [, year, month, day] = match;
  const dt = new Date(Number(year), Number(month) - 1, Number(day));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
