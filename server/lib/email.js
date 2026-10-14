// Transactional email via Resend's plain HTTP API (Keeley's choice, 2026-09-10) - a single fetch
// call needs no SDK dependency, consistent with this app's preference for hand-rolled integrations
// over pulling in another package for something this small.
//
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL in .env (see .env.example). RESEND_FROM_EMAIL
// must be an address on a domain verified in the Resend dashboard - Resend rejects sends from an
// unverified domain, so this throws a clear error rather than silently failing if that happens.
// `attachments` (optional, Keeley's request, 2026-09-22: email the trainer their AHA roster PDF)
// is a list of { filename, content } where `content` is the file's bytes base64-encoded -
// Resend's own attachment shape, passed straight through. `replyTo` (optional) is where replies
// go instead of the unmonitored sending address - the certificate emails set it to whoever sent them.
// `fromName` (optional) swaps the display name on RESEND_FROM_EMAIL for this one email, keeping the
// same address (Keeley's request, 2026-10-14: certificate emails show "ESR: Completed Training").
//
// Sends go out one at a time, at most ~2 a second, and a "too many requests" answer is retried
// (Keeley's report, 2026-10-05: a trainer never got a close-out email). Resend accepts about 2
// requests a second, and the close-out email used to go to every recipient at once - the extra
// sends were refused and only written to the server log.
// The sender name on every email the app sends (Keeley's request, 2026-10-14), whatever name
// RESEND_FROM_EMAIL carries - except where a caller passes its own `fromName` (the certificate
// emails, "ESR: Completed Training").
const DEFAULT_FROM_NAME = 'ESR Training Portal';

const MIN_GAP_MS = 600;
const MAX_ATTEMPTS = 5;
let queue = Promise.resolve();
let lastSentAt = 0;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// "Safety Training Matrix <noreply@x.com>" + "ESR: Completed Training" -> the same address under the
// new name. Quoted, since a name with a colon must be.
function withFromName(from, name) {
  if (!name) return from;
  const address = (/<([^>]+)>/.exec(from) || [null, from])[1].trim();
  return `"${String(name).replace(/["\\]/g, '')}" <${address}>`;
}

async function sendNow({ to, subject, html, attachments, replyTo, fromName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ? withFromName(process.env.RESEND_FROM_EMAIL, fromName || DEFAULT_FROM_NAME) : null;
  if (!apiKey || !from) {
    throw new Error('Email is not configured - RESEND_API_KEY and RESEND_FROM_EMAIL must be set in .env.');
  }

  for (let attempt = 1; ; attempt += 1) {
    const wait = lastSentAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait); // eslint-disable-line no-await-in-loop
    lastSentAt = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, ...(attachments?.length ? { attachments } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt); // eslint-disable-line no-await-in-loop
      continue; // eslint-disable-line no-continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => ''); // eslint-disable-line no-await-in-loop
      throw new Error(`Resend API error (${res.status}): ${body || 'no response body'}`);
    }
    return;
  }
}

function sendEmail(message) {
  const result = queue.then(() => sendNow(message));
  queue = result.catch(() => {});
  return result;
}

module.exports = { sendEmail };
