// Shared look for the downloadable report PDFs (Keeley's request, 2026-10-27: "I want nice
// pdfs") - the same ESR theme as the employee Training Record export (lib/employeeTrainingExport.js):
// logo, gold rule, Montserrat headings over Open Sans text, green table headers, page footers.
// Everything here draws straight onto the response stream - nothing is saved to disk.
const path = require('path');
const PDFDocument = require('pdfkit');

const ASSETS = path.join(__dirname, '..', 'assets');
const GREEN = '#026754';
const GOLD = '#c49b0d';
const GOLD_INK = '#8a6c05';
const NAVY = '#1f3a53';
const TINT = '#eaf2ef';
const MUTED = '#62676f';
const RED = '#b42318';
const INK = '#1a1d21';

const STATUS_COLORS = { Current: GREEN, 'No Expiration': GREEN, 'Expiring Soon': GOLD_INK, Expired: RED, Issued: GREEN, 'Not on file': RED };

function usDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (d || '');
}

function generatedOn() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
}

// Header block: logo + small caps label on the right, gold rule, big title, grey sub-lines.
// Returns the drawing context every other helper takes.
function startReport(out, { label, title, subLines = [], landscape = false, docTitle }) {
  const doc = new PDFDocument({
    size: 'LETTER', layout: landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true,
    info: { Title: docTitle || title, Author: 'Evolution Safety Resources' },
  });
  doc.registerFont('Head', path.join(ASSETS, 'fonts', 'Montserrat-Bold.woff'));
  doc.registerFont('HeadSemi', path.join(ASSETS, 'fonts', 'Montserrat-SemiBold.woff'));
  doc.registerFont('Body', path.join(ASSETS, 'fonts', 'OpenSans-Regular.woff'));
  doc.registerFont('BodySemi', path.join(ASSETS, 'fonts', 'OpenSans-SemiBold.woff'));
  doc.pipe(out);

  const ctx = { doc, left: 40, width: doc.page.width - 80, bottom: doc.page.height - 56, y: 0 };
  doc.image(path.join(ASSETS, 'esr-logo-full.png'), ctx.left, 36, { height: 40 });
  doc.font('Head').fontSize(9).fillColor(GOLD_INK).text(label.toUpperCase(), ctx.left, 50, { width: ctx.width, align: 'right', characterSpacing: 1.6 });
  doc.rect(ctx.left, 86, ctx.width, 3).fill(GOLD);

  doc.font('Head').fontSize(20).fillColor(NAVY).text(title, ctx.left, 102, { width: ctx.width });
  for (const line of subLines.filter(Boolean)) {
    doc.font('Body').fontSize(10.5).fillColor(MUTED).text(line, ctx.left, doc.y + 2, { width: ctx.width });
  }
  doc.font('Body').fontSize(9).fillColor(MUTED).text(`Generated ${generatedOn()}`, ctx.left, doc.y + 2, { width: ctx.width });
  ctx.y = doc.y + 12;
  return ctx;
}

// Up to five summary tiles in a row: [label, value, color].
function drawTiles(ctx, tiles) {
  const { doc, left, width } = ctx;
  const gap = 10;
  const tileW = (width - (tiles.length - 1) * gap) / tiles.length;
  tiles.forEach(([label, value, color = NAVY], i) => {
    const x = left + i * (tileW + gap);
    doc.rect(x, ctx.y, tileW, 50).fill(TINT);
    doc.rect(x, ctx.y, 3, 50).fill(color);
    doc.font('Head').fontSize(18).fillColor(color).text(String(value), x + 12, ctx.y + 7, { width: tileW - 16 });
    doc.font('HeadSemi').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 12, ctx.y + 32, { width: tileW - 16, characterSpacing: 0.6 });
  });
  ctx.y += 66;
}

function newPage(ctx) {
  ctx.doc.addPage();
  ctx.y = 40;
}

// Makes sure `height` more points fit on this page, starting a new one if not.
function ensureSpace(ctx, height) {
  if (ctx.y + height > ctx.bottom) newPage(ctx);
}

// A section title (e.g. one class, or one employee) with an optional grey line under it.
function drawSectionHeading(ctx, title, sub) {
  const { doc, left, width } = ctx;
  doc.font('Head').fontSize(12);
  const titleH = doc.heightOfString(title, { width });
  doc.font('Body').fontSize(9);
  const subH = sub ? doc.heightOfString(sub, { width }) + 2 : 0;
  // Keep the heading with its table header and at least one row.
  ensureSpace(ctx, titleH + subH + 60);
  doc.font('Head').fontSize(12).fillColor(NAVY).text(title, left, ctx.y, { width });
  if (sub) doc.font('Body').fontSize(9).fillColor(MUTED).text(sub, left, doc.y + 1, { width });
  ctx.y = doc.y + 6;
}

// columns: [{ key, label, weight }] - widths are shared out by weight. A cell in a column whose
// key is "status" or "certificate" is colored by its value (Current green, Expired red, ...).
function drawTable(ctx, columns, rows, { emptyText = 'Nothing to show.' } = {}) {
  const { doc, left, width } = ctx;
  const totalWeight = columns.reduce((s, c) => s + (c.weight || 1), 0);
  const cols = columns.map((c) => ({ ...c, w: (width * (c.weight || 1)) / totalWeight }));
  const colored = (key) => key === 'status' || key === 'certificate';
  const text = (r, key) => {
    const v = r[key];
    return v === undefined || v === null || v === '' ? '—' : String(v);
  };
  const headerRow = () => {
    doc.rect(left, ctx.y, width, 20).fill(GREEN);
    let x = left;
    for (const c of cols) {
      // Shrink a long label to fit its column rather than wrap it ("COMPLETE / D").
      const label = c.label.toUpperCase();
      let size = 7.5;
      while (size > 5.5 && doc.font('Head').fontSize(size).widthOfString(label) + 0.6 * label.length > c.w - 12) size -= 0.25;
      doc.font('Head').fontSize(size).fillColor('#ffffff').text(label, x + 6, ctx.y + 6.5 + (7.5 - size) / 2, { characterSpacing: 0.6, lineBreak: false });
      x += c.w;
    }
    ctx.y += 20;
  };

  if (!rows.length) {
    doc.font('Body').fontSize(10).fillColor(MUTED).text(emptyText, left, ctx.y, { width });
    ctx.y = doc.y + 10;
    return;
  }
  ensureSpace(ctx, 44);
  headerRow();
  rows.forEach((r, i) => {
    doc.font('Body').fontSize(9);
    const h = Math.max(...cols.map((c) => doc.heightOfString(text(r, c.key), { width: c.w - 12 }))) + 10;
    if (ctx.y + h > ctx.bottom) {
      newPage(ctx);
      headerRow();
    }
    if (i % 2 === 1) doc.rect(left, ctx.y, width, h).fill('#f6f7f9');
    let x = left;
    for (const c of cols) {
      const value = text(r, c.key);
      doc.font(colored(c.key) || c.bold ? 'BodySemi' : 'Body').fontSize(9)
        .fillColor(colored(c.key) ? STATUS_COLORS[value] || NAVY : INK)
        .text(value, x + 6, ctx.y + 5, { width: c.w - 12 });
      x += c.w;
    }
    ctx.y += h;
    doc.moveTo(left, ctx.y).lineTo(left + width, ctx.y).lineWidth(0.5).strokeColor('#e2e5e9').stroke();
  });
  ctx.y += 14;
}

// Footer on every page, then close the stream.
function finishReport(ctx, footerLabel) {
  const { doc, left, width } = ctx;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing below the margin would otherwise start a new page
    const fy = doc.page.height - 36;
    doc.rect(left, fy - 8, width, 0.75).fill(GOLD);
    doc.font('HeadSemi').fontSize(7.5).fillColor(GREEN).text('EVOLUTION SAFETY RESOURCES', left, fy, { width: width / 2, characterSpacing: 0.8, lineBreak: false });
    doc.font('Body').fontSize(7.5).fillColor(MUTED).text(`${footerLabel} · Page ${i - range.start + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
  }
  doc.end();
}

// Sets download headers - plain-ASCII filename plus the UTF-8 one for accented names.
function sendAs(res, filename, type) {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.type(type);
}

function safeFilePart(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  GREEN, GOLD_INK, NAVY, RED, usDate, startReport, drawTiles, drawSectionHeading, drawTable, ensureSpace, finishReport, sendAs, safeFilePart,
};
