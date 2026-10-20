// Machine translation for the sign-in page's Spanish text (Keeley's request). Called only when
// an admin saves a session with language 'spanish'/'both' - never from the public sign-in page
// itself - so the result is cached on the session row and attendee traffic never triggers a
// translation call. If DEEPL_API_KEY is ever missing/invalid, this throws a clear, catchable
// error; callers must not let that block saving the session itself.
function endpointFor(apiKey) {
  return apiKey.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
}

async function translateToSpanish(text) {
  if (!text || !text.trim()) return '';
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    throw new Error('Spanish translation is not set up yet (DEEPL_API_KEY is missing).');
  }
  const res = await fetch(endpointFor(apiKey), {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text, source_lang: 'EN', target_lang: 'ES' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Translation request failed (${res.status}): ${body || 'no details'}`);
  }
  const data = await res.json();
  return data.translations?.[0]?.text || '';
}

// Trainee feedback comments written in Spanish (or any other language) come back in English, so
// the office doesn't translate them by hand (Keeley's request, 2026-10-20). DeepL detects the
// language; English text returns null (nothing to translate), as does a "translation" that only
// changes letter case or punctuation.
async function translateToEnglish(text) {
  // Too short to tell the language ("ok", "na") - left as written.
  if (!text || text.replace(/[^\p{L}]/gu, '').length < 4) return null;
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) throw new Error('Translation is not set up (DEEPL_API_KEY is missing).');
  const res = await fetch(endpointFor(apiKey), {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text, target_lang: 'EN-US' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Translation request failed (${res.status}): ${body || 'no details'}`);
  }
  const data = await res.json();
  const result = data.translations?.[0];
  if (!result?.text || String(result.detected_source_language || '').toUpperCase() === 'EN') return null;
  const plain = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return plain(result.text) === plain(text) ? null : result.text;
}

// A feedback comment as it's saved: { comment: English, original: the trainee's words, or null
// when it was already English }. A failed translation keeps the comment as written - feedback is
// never lost over it.
async function englishComment(text) {
  if (!text) return { comment: text, original: null };
  try {
    const english = await translateToEnglish(text);
    return english ? { comment: english, original: text } : { comment: text, original: null };
  } catch (err) {
    console.error('Feedback comment translation failed:', err.message); // eslint-disable-line no-console
    return { comment: text, original: null };
  }
}

module.exports = { translateToSpanish, translateToEnglish, englishComment };
