// Watches the folder the Epson scanner saves into (Keeley's request, 2026-10-12) so a card scanned
// while an employee's page is open shows up there, ready to label and attach to one of their
// trainings. Browsers can't drive a scanner, but Chrome/Edge can read a folder the user picks
// (File System Access API) - ScanSmart saves each scan there and this picks it up.
//
// Lives at module level, not in a component, so it keeps watching while you move from one
// employee to the next; a full page reload starts it over. Read-only: scans are never moved or
// deleted from the folder.

const POLL_MS = 1500;
const SCAN_FILE = /\.(pdf|jpe?g|png)$/i;

export const scanFolderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// The picked folder is remembered in IndexedDB (a folder handle can't go in localStorage), so the
// next visit only needs Chrome's one-click "allow" instead of picking the folder again.
const DB_NAME = 'esr-scan-folder';
const STORE = 'handles';
const KEY = 'scanFolder';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadSavedFolder() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveFolder(handle) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, KEY);
  } catch { /* remembering the folder is a convenience - picking it again still works */ }
}

let state = { folderName: '', watching: false, pending: [], error: '' };
let folder = null;
let timer = null;
const listeners = new Set();
// name -> "size:lastModified" for every file already in the folder or already picked up.
let seen = new Map();
// A new file waits one poll with an unchanged size before it's picked up, so a scan that's
// still being written isn't grabbed half-finished.
let settling = new Map();
let nextId = 1;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function subscribeToScans(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// Preload the remembered folder so the Start click can ask for permission straight away
// (Chrome only allows that prompt right after a click).
const savedFolderReady = scanFolderSupported ? loadSavedFolder().then((h) => {
  if (h && !folder) { folder = h; set({ folderName: h.name }); }
}) : Promise.resolve();

async function listScanFiles(dir) {
  const files = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && SCAN_FILE.test(entry.name)) files.push(entry);
  }
  return files;
}

async function poll() {
  if (!state.watching || !folder) return;
  try {
    for (const entry of await listScanFiles(folder)) {
      if (seen.has(entry.name)) continue;
      const file = await entry.getFile();
      const sig = `${file.size}:${file.lastModified}`;
      if (file.size > 0 && settling.get(entry.name) === sig) {
        settling.delete(entry.name);
        seen.set(entry.name, sig);
        set({ pending: [...state.pending, { id: nextId++, file, name: entry.name, url: URL.createObjectURL(file) }] });
      } else {
        settling.set(entry.name, sig);
      }
    }
  } catch (err) {
    stopWatching();
    set({ error: `Lost access to the scan folder (${err.message}). Click Start scanning to pick it again.` });
    return;
  }
  timer = setTimeout(poll, POLL_MS);
}

// Call from a click. Re-uses the remembered folder unless `pickNew`; whatever's already in the
// folder is skipped - only scans that arrive after this point are picked up.
export async function startWatching({ pickNew = false } = {}) {
  set({ error: '' });
  try {
    await savedFolderReady;
    let dir = pickNew ? null : folder;
    if (dir) {
      let permission = await dir.queryPermission({ mode: 'read' });
      if (permission !== 'granted') permission = await dir.requestPermission({ mode: 'read' });
      if (permission !== 'granted') dir = null;
    }
    if (!dir) {
      dir = await window.showDirectoryPicker({ id: 'esr-scans', mode: 'read' });
      saveFolder(dir);
    }
    folder = dir;
    seen = new Map();
    settling = new Map();
    for (const entry of await listScanFiles(dir)) {
      const file = await entry.getFile();
      seen.set(entry.name, `${file.size}:${file.lastModified}`);
    }
    clearTimeout(timer);
    set({ folderName: dir.name, watching: true });
    timer = setTimeout(poll, POLL_MS);
  } catch (err) {
    if (err.name === 'AbortError') return; // closed the folder picker
    set({ error: `Couldn't open the scan folder: ${err.message}` });
  }
}

export function stopWatching() {
  clearTimeout(timer);
  timer = null;
  set({ watching: false });
}

// Taken off the list once saved (or skipped). The file itself stays in the scan folder.
export function dismissScan(id) {
  const scan = state.pending.find((s) => s.id === id);
  if (scan) URL.revokeObjectURL(scan.url);
  set({ pending: state.pending.filter((s) => s.id !== id) });
}
