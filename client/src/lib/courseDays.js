// A training type set up as a multi-day course (migration 082, Keeley's request, 2026-10-14: OSHA 10
// is 2 days, OSHA 30 is 4) - its number of days and each day's outline, or null for a one-day
// training. default_day_outlines comes from the server as JSON text.
export function courseDays(training) {
  const days = Number(training?.default_total_days) || 0;
  if (days < 2) return null;
  let outlines = [];
  try {
    const parsed = JSON.parse(training.default_day_outlines || '[]');
    if (Array.isArray(parsed)) outlines = parsed;
  } catch {
    outlines = [];
  }
  return { days, outlines: Array.from({ length: days }, (_, i) => String(outlines[i] || '')) };
}

// Fits a per-day list to `count` days: cut short, or padded with `fill(i)` for each new day.
export function resizeDays(list, count, fill = () => '') {
  return count <= list.length ? list.slice(0, count) : [...list, ...Array.from({ length: count - list.length }, (_, i) => fill(list.length + i))];
}

// The whole course's outline, for the session's one Outline field: each day's under its heading.
export function joinDayOutlines(outlines) {
  return outlines.map((o, i) => `Day ${i + 1}:\n${String(o || '').trim()}`).join('\n\n');
}
