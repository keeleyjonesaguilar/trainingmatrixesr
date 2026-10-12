// Reads a scanned card for the upload screens (Keeley's request, 2026-10-12): a preview image of
// its first page, and whatever text is in it so the name on the card can be matched to a person.
// The preview is drawn with pdf.js into a data: image - the live site's CSP blocks showing a
// blob: PDF in an iframe, which is what gave the broken-image box. Text is only there when the
// scan was saved as a searchable PDF (ScanSmart's Searchable PDF option runs Epson's OCR).
// pdf.js is loaded on first use, so it stays out of the main bundle.

let pdfjsReady = null;
function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      });
  }
  return pdfjsReady;
}

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

// -> { preview: data URL or null, text: '' when the file has none }
export async function readCard(file) {
  if (!/\.pdf$/i.test(file.name)) return { preview: await fileToDataUrl(file), text: '' };
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const first = await doc.getPage(1);
    const viewport = first.getViewport({ scale: Math.min(2, 640 / first.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    // 'print' draws in one go; the default display mode waits on animation frames, which never
    // come while the tab is in the background - the preview would hang on "Loading".
    await first.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
    const parts = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = n === 1 ? first : await doc.getPage(n); // eslint-disable-line no-await-in-loop
      parts.push((await page.getTextContent()).items.map((item) => item.str).join(' ')); // eslint-disable-line no-await-in-loop
    }
    return { preview: canvas.toDataURL('image/jpeg', 0.85), text: parts.join(' ') };
  } finally {
    doc.destroy();
  }
}

export const nameWords = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);

// OCR misreads a letter here and there - "Gonzalez" read as "Gonza1ez" still counts.
function closeEnough(a, b) {
  if (a === b) return true;
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; } else {
      edits += 1;
      if (edits > 1) return false;
      if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// True when every word of `name` shows up in `text` (allowing one OCR slip per word).
export function nameAppearsIn(name, text) {
  const want = nameWords(name);
  const have = nameWords(text);
  return want.length > 0 && want.every((w) => have.some((h) => closeEnough(w, h)));
}

// The one person (of `people`, each with a `trainee_name`) whose name is on the card; null when
// none or more than one fit equally well - then you pick.
export function personNamedIn(text, people) {
  if (!text.trim()) return null;
  let best = null;
  let bestLength = 0;
  let tie = false;
  for (const p of people) {
    if (!nameAppearsIn(p.trainee_name, text)) continue; // eslint-disable-line no-continue
    const length = nameWords(p.trainee_name).length;
    if (length > bestLength) { best = p; bestLength = length; tie = false; } else if (length === bestLength) tie = true;
  }
  return tie ? null : best;
}
