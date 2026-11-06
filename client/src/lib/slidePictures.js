// Real pictures of a deck's slides on the Content page (migration 093, Keeley 2026-11-06: the
// cards "need to show the full slide"). The server keeps a PDF of each deck made by the slide
// converter - one page per slide, in the file's order (`pictures_order` = slide part names). Each
// page is drawn with pdf.js into a small image for its card; a bigger one is drawn when a picture
// is clicked. data: images, since the live site's CSP doesn't allow blob: ones.
import { useEffect, useRef, useState } from 'react';
import { loadPdfjs } from './cardReader';

async function drawPage(doc, pageNumber, width) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // 'print' draws in one go even while the tab is in the background (see cardReader.js).
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.85);
  page.cleanup();
  return url;
}

// -> { pictures: { [part_name]: data URL }, state: 'off' | 'loading' | 'ready' | 'unusable',
//      enlarge(part_name) -> Promise<data URL> }
export function useSlidePictures(deck) {
  const [pictures, setPictures] = useState({});
  const [state, setState] = useState('off');
  const docRef = useRef(null);
  const order = deck && deck.pictures === 'ready' ? deck.pictures_order : null;
  const key = order ? `${deck.deck_id}:${order.join('|')}` : null;

  useEffect(() => {
    if (!key) { setPictures({}); setState('off'); return undefined; }
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const res = await fetch(`/api/content/decks/${deck.deck_id}/slides.pdf`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), isEvalSupported: false }).promise;
        if (cancelled) { doc.destroy(); return; }
        docRef.current = doc;
        // Pages must line up with slides one-to-one, or a card could show the wrong slide.
        if (doc.numPages !== order.length) { setState('unusable'); return; }
        const width = Math.min(640, Math.round(320 * (window.devicePixelRatio || 1)));
        const done = {};
        for (let i = 0; i < order.length && !cancelled; i += 1) {
          done[order[i]] = await drawPage(doc, i + 1, width); // eslint-disable-line no-await-in-loop
          if (i % 4 === 3 || i === order.length - 1) setPictures({ ...done });
        }
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('unusable');
      }
    })();
    return () => {
      cancelled = true;
      if (docRef.current) { docRef.current.destroy(); docRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const enlarge = async (partName) => {
    const doc = docRef.current;
    const index = order ? order.indexOf(partName) : -1;
    if (!doc || index < 0) return pictures[partName] || null;
    return drawPage(doc, index + 1, Math.min(1600, Math.round(window.innerWidth * (window.devicePixelRatio || 1))));
  };

  return { pictures, state, enlarge };
}
