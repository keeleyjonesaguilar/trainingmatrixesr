// Splits one scanned PDF holding a whole class's cards into one PDF per card (Keeley's request,
// 2026-10-12: scan every OSHA card into one file, then sort each to its person). pdf-lib is loaded
// only when a PDF is actually split, so it stays out of the main bundle.

// `pagesPerCard` 2 = each card was scanned front then back. Anything that isn't a multi-page PDF
// comes back as-is.
export async function splitPdfIntoCards(file, pagesPerCard = 1) {
  if (!/\.pdf$/i.test(file.name)) return [file];
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (pageCount <= pagesPerCard) return [file];

  const base = file.name.replace(/\.pdf$/i, '');
  const cards = [];
  for (let start = 0; start < pageCount; start += pagesPerCard) {
    const indices = [];
    for (let p = start; p < Math.min(start + pagesPerCard, pageCount); p += 1) indices.push(p);
    const out = await PDFDocument.create();
    (await out.copyPages(source, indices)).forEach((page) => out.addPage(page));
    const pages = indices.length > 1 ? `pages ${indices[0] + 1}-${indices[indices.length - 1] + 1}` : `page ${indices[0] + 1}`;
    cards.push(new File([await out.save()], `${base} - ${pages}.pdf`, { type: 'application/pdf' }));
  }
  return cards;
}

// Turns a card clockwise by `quarters` quarter turns (Keeley's request, 2026-11-03: phone scans of
// checklists came in sideways). A PDF keeps its scan and only gets its pages' rotation changed; a
// JPG or PNG is redrawn turned. The file keeps its name, so what's uploaded is the turned card.
export async function rotateCard(file, quarters = 1) {
  if (/\.pdf$/i.test(file.name)) {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    doc.getPages().forEach((page) => page.setRotation(degrees((page.getRotation().angle + 90 * quarters) % 360)));
    return new File([await doc.save()], file.name, { type: 'application/pdf' });
  }
  // Read as a data: URL - the live site's CSP doesn't let a blob: URL load as an image.
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const canvas = await turnedCanvas(dataUrl, quarters);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not turn the image'))), type, 0.92);
  });
  return new File([blob], file.name, { type });
}

// The card's preview image, turned the same way - quicker than drawing the page again.
export async function rotatePreview(dataUrl, quarters = 1) {
  return (await turnedCanvas(dataUrl, quarters)).toDataURL('image/jpeg', 0.85);
}

function turnedCanvas(src, quarters) {
  const turns = ((quarters % 4) + 4) % 4;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sideways = turns % 2 === 1;
      const canvas = document.createElement('canvas');
      canvas.width = sideways ? img.naturalHeight : img.naturalWidth;
      canvas.height = sideways ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((turns * Math.PI) / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}
