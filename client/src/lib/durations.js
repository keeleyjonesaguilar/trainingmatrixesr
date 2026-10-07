// Session durations are free text ("4 hours", "3.5", "90 minutes"). A session with 2+ trainings
// stores each training's own duration, and its total is worked out by adding them up (Keeley's
// report, 2026-10-07: changing one training's hours was changing the total at the top - the first
// training's duration and the session total used to be the same field). Same rules as
// server/lib/durations.js.

// "4 hours" -> 240, "1 hr 30 min" -> 90, "3.5" -> 210, "Half day" -> null.
export function durationMinutes(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/.exec(s);
  const minutes = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/.exec(s);
  if (!hours && !minutes) return null;
  return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
}

// 120 -> "2 hours", 60 -> "1 hour", 150 -> "2.5 hours", 30 -> "30 minutes", 100 -> "1 hour 40 minutes".
export function formatMinutes(total) {
  if (total < 60) return `${total} minutes`;
  if (total % 60 === 0) return `${total / 60} hour${total === 60 ? '' : 's'}`;
  if (total % 15 === 0) return `${total / 60} hours`;
  const h = Math.floor(total / 60);
  return `${h} hour${h === 1 ? '' : 's'} ${total % 60} minutes`;
}

// The session total: the sum of every duration that reads as a length of time (a note like "Part
// of New Hire Orientation" adds nothing); when none do, the durations as typed, joined.
export function totalDuration(durations) {
  const typed = durations.map((d) => String(d || '').trim()).filter(Boolean);
  const minutes = typed.map(durationMinutes).filter((m) => m !== null);
  if (minutes.length) return formatMinutes(minutes.reduce((a, b) => a + b, 0));
  return typed.join(' + ') || null;
}
