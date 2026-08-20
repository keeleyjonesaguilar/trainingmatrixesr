// Machine translation for the sign-in page's Spanish text (Keeley's request). Called only when
// an admin saves a session with language 'spanish'/'both' - never from the public sign-in page
// itself - so the result is cached on the session row and attendee traffic never triggers a
// translation call. DEEPL_API_KEY isn't set up yet, so this throws a clear, catchable error
// until Keeley provides one; callers must not let that block saving the session itself.
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

module.exports = { translateToSpanish };
