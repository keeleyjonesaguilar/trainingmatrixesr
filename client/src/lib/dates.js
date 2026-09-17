// Every timestamp in this app (signed_at, created_at, attempted_at, etc.) is stored in UTC -
// displaying it pinned to Eastern (rather than the viewer's own machine timezone) means everyone
// sees the same business-standard time regardless of where they're logging in from (Keeley's
// request, 2026-09-17). Matches the equivalent fix in server/lib/pdfGen.js for certificates/rosters.
export const EASTERN_TZ = 'America/New_York';

export function formatEasternDateTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-US', { timeZone: EASTERN_TZ });
}

export function formatEasternDate(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-US', { timeZone: EASTERN_TZ });
}
