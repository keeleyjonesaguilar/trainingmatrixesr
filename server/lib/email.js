// Transactional email via Resend's plain HTTP API (Keeley's choice, 2026-09-10) - a single fetch
// call needs no SDK dependency, consistent with this app's preference for hand-rolled integrations
// over pulling in another package for something this small.
//
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL in .env (see .env.example). RESEND_FROM_EMAIL
// must be an address on a domain verified in the Resend dashboard - Resend rejects sends from an
// unverified domain, so this throws a clear error rather than silently failing if that happens.
// `attachments` (optional, Keeley's request, 2026-09-22: email the trainer their AHA roster PDF)
// is a list of { filename, content } where `content` is the file's bytes base64-encoded -
// Resend's own attachment shape, passed straight through.
async function sendEmail({ to, subject, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error('Email is not configured - RESEND_API_KEY and RESEND_FROM_EMAIL must be set in .env.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, ...(attachments?.length ? { attachments } : {}) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body || 'no response body'}`);
  }
}

module.exports = { sendEmail };
