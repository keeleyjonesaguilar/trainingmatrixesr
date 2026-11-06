// Phone tables (Keeley, 2026-11-06: "the mobile version is trash"). On a phone, every list table
// turns into a stack of cards - one card per row, each value with its column name beside it -
// instead of a cut-off grid you have to drag sideways. The CSS that does the stacking is in
// esr-theme.css (table[data-stack]); this only copies each column's heading onto its cells
// (data-label) so the card can show it. Nothing here changes what a table holds or does.
//
// The employee/training grids (.matrix-scroll) stay grids - a row there is one person across
// every training, which only reads as a grid. A table can opt out with className="no-stack".

const PHONE = '(max-width: 640px)';
const SKIP = '.matrix-scroll table, table.no-stack';

// Sort arrows and the like are part of a heading's text but not its name.
const cleanHeading = (text) => text.replace(/[▲▼↑↓⇅]/g, '').replace(/\s+/g, ' ').trim();

function labelTable(table) {
  if (table.matches(SKIP)) {
    if (table.hasAttribute('data-stack')) table.removeAttribute('data-stack');
    return;
  }
  const headRows = table.tHead ? table.tHead.rows : [];
  const head = headRows.length ? headRows[headRows.length - 1] : null;
  if (!head) return;
  const labels = [];
  for (const th of head.cells) {
    const text = cleanHeading(th.textContent || '');
    for (let i = 0; i < (th.colSpan || 1); i += 1) labels.push(text);
  }
  if (!table.hasAttribute('data-stack')) table.setAttribute('data-stack', '');
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let col = 0;
      for (const cell of row.cells) {
        // A cell spanning the whole row ("No sessions yet.") gets no label.
        const label = row.cells.length === 1 && cell.colSpan > 1 ? '' : labels[col] || '';
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        // A blank value ("—") is left off the phone card rather than shown as its own line.
        const blank = !cell.querySelector('input, select, button, a, img, svg') && /^[-—–\s]*$/.test(cell.textContent || '');
        if (blank !== cell.hasAttribute('data-blank')) cell.toggleAttribute('data-blank', blank);
        col += cell.colSpan || 1;
      }
    }
  }
}

export function installStackedTables() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const phone = window.matchMedia(PHONE);
  let queued = false;
  const scan = () => {
    queued = false;
    if (!phone.matches) return;
    document.querySelectorAll('table').forEach(labelTable);
  };
  const queue = () => {
    if (queued || !phone.matches) return;
    queued = true;
    requestAnimationFrame(scan);
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (phone.addEventListener) phone.addEventListener('change', queue);
  queue();
}
