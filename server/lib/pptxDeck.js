// Reading and rebuilding PowerPoint (.pptx) files for the Content page (migration 091, Keeley's
// "Training matrix features 11.6", 2026-11-06).
//
// A .pptx is a zip of XML parts. Reading pulls out each slide's title, text, speaker notes,
// transition and first picture for the slide cards. Rebuilding writes a copy with the office's
// settings applied - slide order, hidden slides, transitions - and, for a class download, an extra
// Sign-In QR slide first and/or a Feedback QR slide last. Nothing else in the file is touched.
//
// Everything streams one zip entry at a time (yauzl in, archiver out), so a 200 MB deck full of
// video never sits in memory - the live server has very little of it.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const yauzl = require('yauzl');
const archiver = require('archiver');

const REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const REL_LAYOUT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const REL_NOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';

// The transitions the Content page offers. null = keep whatever the PowerPoint file has.
const TRANSITIONS = {
  none: { label: 'None', xml: null },
  fade: { label: 'Fade', xml: '<p:transition spd="med"><p:fade/></p:transition>' },
  push: { label: 'Push', xml: '<p:transition spd="med"><p:push dir="u"/></p:transition>' },
  wipe: { label: 'Wipe', xml: '<p:transition spd="med"><p:wipe dir="r"/></p:transition>' },
  split: { label: 'Split', xml: '<p:transition spd="med"><p:split orient="vert" dir="out"/></p:transition>' },
  cover: { label: 'Cover', xml: '<p:transition spd="med"><p:cover dir="l"/></p:transition>' },
  cut: { label: 'Cut', xml: '<p:transition><p:cut/></p:transition>' },
};

// Media is already compressed - storing it as-is is much faster than squeezing it again.
const STORE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.m4v', '.mov', '.wmv', '.avi', '.mp3', '.m4a', '.wma', '.zip', '.jfif', '.webp']);

// ---------------------------------------------------------------- zip helpers

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function entryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

async function entryBuffer(zip, entry) {
  const stream = await entryStream(zip, entry);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Every entry of the zip, in file order (name -> yauzl entry).
async function listEntries(zip) {
  const entries = new Map();
  await new Promise((resolve, reject) => {
    zip.on('entry', (entry) => { entries.set(entry.fileName, entry); zip.readEntry(); });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });
  return entries;
}

// ---------------------------------------------------------------- XML helpers

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function escXml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

// Relationship id -> { type, target } from a .rels part.
function parseRels(xml) {
  const rels = new Map();
  for (const m of String(xml || '').matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], 'Id');
    if (id) rels.set(id, { type: attr(m[0], 'Type'), target: attr(m[0], 'Target'), external: attr(m[0], 'TargetMode') === 'External' });
  }
  return rels;
}

// "ppt/slides/slide3.xml" + "../media/image2.png" -> "ppt/media/image2.png"
function resolvePart(fromPart, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPart), target));
}

function relsPartFor(part) {
  return path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`);
}

// The text of each paragraph in a chunk of DrawingML, one line per paragraph.
function paragraphsText(xml) {
  const lines = [];
  for (const p of String(xml).matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\s[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const body = p[1] ?? p[2] ?? '';
    const text = [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t\s[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1] ?? t[2] ?? '')).join('');
    if (text.trim()) lines.push(text.trim());
  }
  return lines;
}

// Each shape on a slide: its placeholder type (if any) and its text.
function shapes(xml) {
  return [...String(xml).matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)].map((m) => {
    const ph = /<p:ph\b[^>]*\/?>/.exec(m[1]);
    return { phType: ph ? (attr(ph[0], 'type') || 'body') : null, lines: paragraphsText(m[1]) };
  });
}

// The slide's title (its title placeholder, else the first line of text) and the rest of its text.
function slideText(xml) {
  const all = shapes(xml);
  const titleShape = all.find((s) => s.phType === 'title' || s.phType === 'ctrTitle');
  const title = titleShape ? titleShape.lines.join(' ') : '';
  const rest = all.filter((s) => s !== titleShape && !['sldNum', 'dt', 'ftr'].includes(s.phType)).flatMap((s) => s.lines);
  // Tables and grouped text live outside <p:sp> too - pick up any text not seen yet.
  const seen = new Set([...(titleShape ? titleShape.lines : []), ...rest]);
  const extra = paragraphsText(String(xml).replace(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g, '')).filter((l) => !seen.has(l));
  const body = [...rest, ...extra];
  return { title: title || body[0] || '', body: (title ? body : body.slice(1)).join('\n') };
}

function notesText(xml) {
  if (!xml) return '';
  return shapes(xml).filter((s) => s.phType === 'body').flatMap((s) => s.lines).join('\n');
}

// The transition element name a slide uses ("fade", "push", "morph", ...), or null.
function fileTransition(xml) {
  const block = /<p:transition\b[^>]*?(\/>|>([\s\S]*?)<\/p:transition>)/.exec(xml);
  if (!block) return null;
  const inner = block[2] || '';
  const child = /<([a-z0-9]+):([a-zA-Z]+)\b/.exec(inner.replace(/<p:(sndAc|stSnd|endSnd|snd)\b[\s\S]*$/, ''));
  return child ? child[2] : 'on';
}

function fingerprint(title, body) {
  const text = `${title}\n${body}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return text ? crypto.createHash('sha1').update(text).digest('hex') : null;
}

// ---------------------------------------------------------------- reading

class DeckError extends Error {}

// Reads a .pptx: its slide size and every slide in show order. Throws DeckError with a message
// the office can act on when the file isn't a usable PowerPoint.
async function readDeck(file) {
  let zip;
  try {
    zip = await openZip(file);
  } catch {
    throw new DeckError('This file isn\'t a PowerPoint (.pptx). If it\'s an older .ppt, open it in PowerPoint and Save As .pptx first.');
  }
  try {
    const entries = await listEntries(zip);
    const read = async (name) => (entries.has(name) ? (await entryBuffer(zip, entries.get(name))).toString('utf8') : null);
    const presentation = await read('ppt/presentation.xml');
    if (!presentation) throw new DeckError('This file isn\'t a PowerPoint (.pptx). If it\'s an older .ppt, open it in PowerPoint and Save As .pptx first.');
    const presRels = parseRels(await read('ppt/_rels/presentation.xml.rels'));
    const size = /<p:sldSz\b[^>]*\/?>/.exec(presentation);
    const slideIds = [...presentation.matchAll(/<p:sldId\b[^>]*\/?>/g)].map((m) => attr(m[0], 'r:id'));
    const slides = [];
    for (const rid of slideIds) {
      const rel = presRels.get(rid);
      if (!rel) continue; // eslint-disable-line no-continue
      const part = resolvePart('ppt/presentation.xml', rel.target);
      const xml = await read(part); // eslint-disable-line no-await-in-loop
      if (!xml) continue; // eslint-disable-line no-continue
      const rels = parseRels(await read(relsPartFor(part))); // eslint-disable-line no-await-in-loop
      const { title, body } = slideText(xml);
      // The card picture: the biggest picture on the slide (not a small logo in the corner), if
      // it's a kind a browser can show.
      let picture = null;
      let biggest = 0;
      for (const pic of xml.matchAll(/<p:pic\b[^>]*>([\s\S]*?)<\/p:pic>/g)) {
        const embed = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(pic[1]);
        const r = embed && rels.get(embed[1]);
        if (!r || r.external || r.type !== REL_IMAGE) continue; // eslint-disable-line no-continue
        const media = resolvePart(part, r.target);
        if (!/\.(png|jpe?g|gif|webp)$/i.test(media) || !entries.has(media)) continue; // eslint-disable-line no-continue
        const ext = /<a:ext\b[^>]*\/?>/.exec(pic[1]);
        const area = ext ? (Number(attr(ext[0], 'cx')) || 0) * (Number(attr(ext[0], 'cy')) || 0) : 1;
        if (area > biggest) { biggest = area; picture = media; }
      }
      const notesRel = [...rels.values()].find((r) => r.type === REL_NOTES);
      const notes = notesRel ? notesText(await read(resolvePart(part, notesRel.target))) : ''; // eslint-disable-line no-await-in-loop
      const sldTag = /<p:sld\b[^>]*>/.exec(xml);
      slides.push({
        part_name: part,
        title: title.slice(0, 300),
        body_text: body.slice(0, 4000),
        notes_text: notes.slice(0, 4000),
        hidden: sldTag && attr(sldTag[0], 'show') === '0' ? 1 : 0,
        file_transition: fileTransition(xml),
        picture_part: picture,
        fingerprint: fingerprint(title, body),
      });
    }
    if (!slides.length) throw new DeckError('This PowerPoint has no slides.');
    return {
      slideWidth: size ? Number(attr(size[0], 'cx')) : 12192000,
      slideHeight: size ? Number(attr(size[0], 'cy')) : 6858000,
      slides,
    };
  } finally {
    zip.close();
  }
}

// Streams one part of the deck (a slide's card picture) to `res`. False if it isn't there.
async function streamPart(file, partName, res) {
  const zip = await openZip(file);
  try {
    const entries = await listEntries(zip);
    const entry = entries.get(partName);
    if (!entry) return false;
    const stream = await entryStream(zip, entry);
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      res.on('close', resolve);
      stream.on('end', resolve);
      stream.pipe(res);
    });
    return true;
  } finally {
    zip.close();
  }
}

// ---------------------------------------------------------------- rebuilding

// A slide's <p:sld> with the hidden flag and transition the office picked.
function applySlideSettings(xml, { hidden, transition }) {
  let out = xml.replace(/<p:sld\b[^>]*>/, (tag) => {
    const clean = tag.replace(/\sshow="[^"]*"/, '');
    return hidden ? clean.replace(/^<p:sld\b/, '<p:sld show="0"') : clean;
  });
  if (transition && TRANSITIONS[transition]) {
    // Drop the slide's own transition - including the newer kinds PowerPoint wraps in
    // <mc:AlternateContent> - then put the chosen one where the file format expects it.
    out = out.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, (block) => (
      block.includes('<p:transition') && (block.match(/<mc:AlternateContent\b/g) || []).length === 1 ? '' : block
    ));
    out = out.replace(/<p:transition\b[^>]*\/>/g, '').replace(/<p:transition\b[^>]*>[\s\S]*?<\/p:transition>/g, '');
    const xmlTransition = TRANSITIONS[transition].xml;
    if (xmlTransition) {
      if (out.includes('</p:clrMapOvr>')) out = out.replace('</p:clrMapOvr>', `</p:clrMapOvr>${xmlTransition}`);
      else out = out.replace('</p:cSld>', `</p:cSld>${xmlTransition}`);
    }
  }
  return out;
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function textBox({ id, name, x, y, cx, cy, paragraphs, fill = null, anchor = 't' }) {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>';
  const paras = paragraphs.map((p) => `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="${p.lang || 'en-US'}" sz="${p.size}" b="${p.bold ? 1 : 0}" i="${p.italic ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${p.color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${escXml(p.text)}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillXml}<a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

// The extra slide a class download gets: a white slide with a colored band saying what it's for,
// the QR code (already labeled SIGN-IN / FEEDBACK, lib/qrLabel.js), the class, and what to do - in
// the class's language (Keeley, 2026-11-06: an English class's slide is English only; Spanish
// classes get Spanish, "English and Spanish" classes both). Laid out from the deck's own slide
// size, so it fits 16:9 and 4:3 alike.
const QR_WORDS = {
  en: {
    band: { signin: 'SIGN IN', feedback: 'FEEDBACK' },
    heading: { signin: "Sign in for today's class", feedback: 'Tell us how we did' },
    steps: {
      signin: ["Open your phone's camera", 'Point it at the QR code', 'Tap the link and sign in'],
      feedback: ["Open your phone's camera", 'Point it at the QR code', 'Tap the link and rate the class'],
    },
  },
  es: {
    band: { signin: 'REGÍSTRESE', feedback: 'COMENTARIOS' },
    heading: { signin: 'Regístrese para la clase de hoy', feedback: 'Díganos cómo lo hicimos' },
    steps: {
      signin: ['Abra la cámara de su teléfono', 'Apúntela al código QR', 'Toque el enlace y regístrese'],
      feedback: ['Abra la cámara de su teléfono', 'Apúntela al código QR', 'Toque el enlace y califique la clase'],
    },
  },
};

function qrSlideXml({ width, height, kind, qrPng, className, classDate, language }) {
  const signIn = kind === 'signin';
  const k = signIn ? 'signin' : 'feedback';
  const color = signIn ? '026754' : '8A6C05';
  const band = Math.round(height * 0.14);
  const img = pngSize(qrPng);
  const imgH = Math.round(height * 0.6);
  const imgW = Math.round(imgH * (img.width / img.height));
  const imgX = Math.round(width * 0.08);
  const imgY = band + Math.round(height * 0.06);
  const textX = imgX + imgW + Math.round(width * 0.04);
  const textW = width - textX - Math.round(width * 0.06);
  const both = language === 'both';
  const main = language === 'spanish' ? QR_WORDS.es : QR_WORDS.en;
  const mainLang = language === 'spanish' ? 'es-ES' : 'en-US';
  const instructions = [
    { text: main.heading[k], size: 3200, bold: true, color, lang: mainLang },
    ...(both ? [{ text: QR_WORDS.es.heading[k], size: 2200, italic: true, color: '62676F', lang: 'es-ES' }] : []),
    { text: ' ', size: 1200, color: '1A1D21' },
    ...main.steps[k].map((s, i) => ({ text: `${i + 1}. ${s}`, size: 2200, color: '1A1D21', lang: mainLang })),
    ...(both ? [
      { text: ' ', size: 1200, color: '1A1D21' },
      { text: `${QR_WORDS.es.steps[k].map((x, i) => (i ? x[0].toLowerCase() + x.slice(1) : x)).join(', ')}.`, size: 1600, italic: true, color: '62676F', lang: 'es-ES' },
    ] : []),
  ];
  const bandText = both ? `${QR_WORDS.en.band[k]} · ${QR_WORDS.es.band[k]}` : main.band[k];
  const shapesXml = [
    // A white backdrop over the deck's own background, so the code always scans cleanly.
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="ESR QR Backdrop"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`,
    textBox({
      id: 3, name: 'ESR QR Heading', x: 0, y: 0, cx: width, cy: band, fill: color, anchor: 'ctr',
      paragraphs: [{ text: bandText, size: Math.round(band / 12700 * 0.42) * 100, bold: true, color: 'FFFFFF' }],
    }),
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="ESR ${signIn ? 'Sign-In' : 'Feedback'} QR Code" descr="${signIn ? 'Sign-in' : 'Feedback'} QR code for this class"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
      + `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
      + `<p:spPr><a:xfrm><a:off x="${imgX}" y="${imgY}"/><a:ext cx="${imgW}" cy="${imgH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    textBox({
      id: 5, name: 'ESR QR Instructions', x: textX, y: imgY, cx: textW, cy: imgH, anchor: 'ctr',
      paragraphs: instructions,
    }),
    textBox({
      id: 6, name: 'ESR QR Class', x: Math.round(width * 0.06), y: imgY + imgH + Math.round(height * 0.03), cx: Math.round(width * 0.88), cy: height - (imgY + imgH + Math.round(height * 0.03)) - Math.round(height * 0.02), anchor: 't',
      paragraphs: [{ text: [className, classDate].filter(Boolean).join('  ·  '), size: 1800, bold: true, color: '1A1D21' }],
    }),
  ];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + shapesXml.join('')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function slideRelsXml(layoutTarget, mediaTarget) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${REL_LAYOUT}" Target="${escXml(layoutTarget)}"/>`
    + `<Relationship Id="rId2" Type="${REL_IMAGE}" Target="${escXml(mediaTarget)}"/>`
    + '</Relationships>';
}

// Writes a copy of the deck to `out` (a writable stream) with:
//   order       - slide part names in the order to show them (any slide left out keeps its place
//                 after the listed ones, so nothing is ever lost)
//   settings    - part name -> { hidden, transition }
//   qrSlides    - [{ where: 'start' | 'end', kind: 'signin' | 'feedback', png, className, classDate, language }]
async function writeDeck(file, { order = [], settings = new Map(), qrSlides = [] }, out) {
  const zip = await openZip(file);
  try {
    const entries = await listEntries(zip);
    const read = async (name) => (entries.has(name) ? (await entryBuffer(zip, entries.get(name))).toString('utf8') : null);
    const replaced = new Map(); // part name -> new content (string or Buffer)

    const presentation = await read('ppt/presentation.xml');
    const presRelsXml = await read('ppt/_rels/presentation.xml.rels');
    const presRels = parseRels(presRelsXml);
    const sldIdTags = [...presentation.matchAll(/<p:sldId\b[^>]*\/?>/g)].map((m) => m[0]);
    const partOfTag = (tag) => {
      const rel = presRels.get(attr(tag, 'r:id'));
      return rel ? resolvePart('ppt/presentation.xml', rel.target) : null;
    };

    // Slide order.
    const rank = new Map(order.map((p, i) => [p, i]));
    const ordered = sldIdTags
      .map((tag, i) => ({ tag, part: partOfTag(tag), i }))
      .sort((a, b) => (rank.has(a.part) ? rank.get(a.part) : order.length + a.i) - (rank.has(b.part) ? rank.get(b.part) : order.length + b.i));

    // The QR slides: new slide + rels + picture parts, wired into the presentation.
    const { slideWidth, slideHeight } = (() => {
      const size = /<p:sldSz\b[^>]*\/?>/.exec(presentation);
      return { slideWidth: size ? Number(attr(size[0], 'cx')) : 12192000, slideHeight: size ? Number(attr(size[0], 'cy')) : 6858000 };
    })();
    const added = [];
    let presRelsOut = presRelsXml;
    let contentTypes = await read('[Content_Types].xml');
    if (qrSlides.length) {
      // A blank layout from the deck's own master, so the new slide belongs to the deck.
      const layoutParts = [...entries.keys()].filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
        .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
      let layout = layoutParts[0];
      for (const lp of layoutParts) {
        const head = ((await read(lp)) || '').slice(0, 2000); // eslint-disable-line no-await-in-loop
        if (/<p:sldLayout\b[^>]*\stype="blank"/.test(head)) { layout = lp; break; }
      }
      if (!layout) throw new DeckError('This PowerPoint has no slide layouts, so the QR slides can\'t be added.');
      let nextSlideNo = Math.max(0, ...[...entries.keys()].map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n)).filter(Boolean).map((m) => Number(m[1]))) + 1;
      let nextId = Math.max(255, ...sldIdTags.map((t) => Number(attr(t, 'id')) || 0)) + 1;
      qrSlides.forEach((q, i) => {
        const slidePart = `ppt/slides/slide${nextSlideNo}.xml`;
        const mediaPart = `ppt/media/esr-${q.kind}-qr-${nextSlideNo}.png`;
        nextSlideNo += 1;
        const rid = `rIdEsrQr${i + 1}`;
        replaced.set(slidePart, qrSlideXml({ width: slideWidth, height: slideHeight, kind: q.kind, qrPng: q.png, className: q.className, classDate: q.classDate, language: q.language }));
        replaced.set(relsPartFor(slidePart), slideRelsXml(`../slideLayouts/${path.posix.basename(layout)}`, `../media/${path.posix.basename(mediaPart)}`));
        replaced.set(mediaPart, q.png);
        presRelsOut = presRelsOut.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_SLIDE}" Target="slides/${path.posix.basename(slidePart)}"/></Relationships>`);
        contentTypes = contentTypes.replace('</Types>', `<Override PartName="/${slidePart}" ContentType="${SLIDE_CONTENT_TYPE}"/></Types>`);
        added.push({ where: q.where, tag: `<p:sldId id="${nextId}" r:id="${rid}"/>` });
        nextId += 1;
      });
      if (!/<Default\b[^>]*Extension="png"/i.test(contentTypes)) {
        contentTypes = contentTypes.replace(/<Types\b[^>]*>/, (t) => `${t}<Default Extension="png" ContentType="image/png"/>`);
      }
      replaced.set('ppt/_rels/presentation.xml.rels', presRelsOut);
      replaced.set('[Content_Types].xml', contentTypes);
    }
    const finalTags = [
      ...added.filter((a) => a.where === 'start').map((a) => a.tag),
      ...ordered.map((o) => o.tag),
      ...added.filter((a) => a.where === 'end').map((a) => a.tag),
    ];
    if (sldIdTags.length || added.length) {
      replaced.set('ppt/presentation.xml', presentation.replace(
        /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/,
        `<p:sldIdLst>${finalTags.join('')}</p:sldIdLst>`
      ));
    }

    // Hidden slides and transitions.
    for (const [part, s] of settings) {
      if (!entries.has(part)) continue; // eslint-disable-line no-continue
      const xml = await read(part); // eslint-disable-line no-await-in-loop
      const updated = applySlideSettings(xml, s);
      if (updated !== xml) replaced.set(part, updated);
    }

    // Write: every original entry in its original order (changed ones swapped in), then the new parts.
    const archive = archiver('zip', { zlib: { level: 6 } });
    const done = new Promise((resolve, reject) => {
      archive.on('error', reject);
      out.on('error', reject);
      out.on('close', resolve);
      out.on('finish', resolve);
    });
    archive.pipe(out);
    const appendNext = async (name, source) => {
      const store = STORE_EXTENSIONS.has(path.posix.extname(name).toLowerCase());
      archive.append(source, { name, store });
      // Wait for this entry to be written before opening the next, so only one is ever in flight.
      await new Promise((resolve, reject) => {
        const onEntry = () => { archive.off('error', onError); resolve(); };
        const onError = (err) => { archive.off('entry', onEntry); reject(err); };
        archive.once('entry', onEntry);
        archive.once('error', onError);
      });
    };
    for (const [name, entry] of entries) {
      if (name.endsWith('/')) continue; // eslint-disable-line no-continue
      if (replaced.has(name)) {
        const content = replaced.get(name);
        await appendNext(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')); // eslint-disable-line no-await-in-loop
        replaced.delete(name);
      } else {
        await appendNext(name, await entryStream(zip, entry)); // eslint-disable-line no-await-in-loop
      }
    }
    for (const [name, content] of replaced) {
      await appendNext(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')); // eslint-disable-line no-await-in-loop
    }
    await archive.finalize();
    await done;
  } finally {
    zip.close();
  }
}

module.exports = { readDeck, writeDeck, streamPart, applySlideSettings, TRANSITIONS, DeckError };
