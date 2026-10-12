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
