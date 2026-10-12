import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api';
import { splitPdfIntoCards } from '../lib/pdfPages.js';
import {
  dismissScan, scanFolderSupported, startWatching, stopWatching, subscribeToScans,
} from '../lib/scanFolderWatcher.js';

// "Upload Attendee Documents" on a closed session (Keeley's request, 2026-10-02): choose several
// files at once (e.g. a CPR class's skills checklists, one per person), each is matched to an
// attendee by the name in its file name, you check or change the matches, and each file is filed
// under that person's Documents - server/routes/trainingSessions.js POST /:id/attendee-documents.
// Since 2026-10-12 a PDF with the whole class's cards in it (scanned or chosen) is split into one
// card per page - or per two pages, front and back - each with a preview to sort to its person.

const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);

// The attendee whose every name word appears in the file name ("Jaymen St.Laurent - CPR.pdf");
// when two fit equally well, nobody - you pick.
function matchAttendee(filename, attendees) {
  const fileWords = new Set(words(filename.replace(/\.[^.]+$/, '')));
  let best = null;
  let bestLength = 0;
  let tie = false;
  for (const a of attendees) {
    const nameWords = words(a.trainee_name);
    if (!nameWords.length || !nameWords.every((w) => fileWords.has(w))) continue; // eslint-disable-line no-continue
    if (nameWords.length > bestLength) { best = a; bestLength = nameWords.length; tie = false; } else if (nameWords.length === bestLength) tie = true;
  }
  return tie ? null : best;
}

// "Chandler Mills - Heartsaver First Aid Skills Checklist - 2026-09-23.pdf" -> "Heartsaver First
// Aid Skills Checklist": the file name without the person's name, a date, or the extension.
function defaultLabel(filename, attendee) {
  const base = filename.replace(/\.[^.]+$/, '');
  const nameWords = attendee ? words(attendee.trainee_name) : [];
  const parts = base.split(/\s+[-–]\s+|_/).map((p) => p.trim()).filter(Boolean)
    .filter((p) => !(nameWords.length && words(p).length && words(p).every((w) => nameWords.includes(w))))
    .filter((p) => !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(p));
  return parts.join(' - ') || base;
}

function CardPreview({ item }) {
  const isPdf = /\.pdf$/i.test(item.file.name);
  return (
    <a href={item.url} target="_blank" rel="noreferrer" title="Open full size" style={{ display: 'block', width: 240 }}>
      {isPdf
        ? <iframe src={`${item.url}#toolbar=0&navpanes=0&view=Fit`} title={item.file.name} loading="lazy" style={{ width: 240, height: 152, border: '1px solid var(--color-border)', borderRadius: 4, pointerEvents: 'none' }} />
        : <img src={item.url} alt={item.file.name} loading="lazy" style={{ width: 240, height: 152, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 4 }} />}
    </a>
  );
}

export default function AttendeeDocumentsUpload({ session, onClose, onDone }) {
  const attendees = (session.attendees || []).filter((a) => a.employee_id);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [pagesPerCard, setPagesPerCard] = useState(1);
  const [scans, setScans] = useState({ folderName: '', watching: false, pending: [], error: '' });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pagesPerCardRef = useRef(pagesPerCard);
  pagesPerCardRef.current = pagesPerCard;
  const takenScans = useRef(new Set());
  const cardLabel = `${session.training_type_label} Card`;

  const addFiles = async (fileList, { fromScanner = false } = {}) => {
    // Copied before the first await - the picker's FileList is emptied when its input is reset.
    const originals = Array.from(fileList);
    setError('');
    setReading(true);
    try {
      const added = [];
      for (const original of originals) {
        // eslint-disable-next-line no-await-in-loop
        const cards = await splitPdfIntoCards(original, pagesPerCardRef.current);
        const split = cards.length > 1;
        cards.forEach((file, i) => {
          // A page cut from a class-wide PDF, or a fresh scan, has no person's name in its file name.
          const match = split || fromScanner ? null : matchAttendee(file.name, attendees);
          added.push({
            key: `${Date.now()}-${added.length}-${i}-${file.name}`,
            file,
            url: URL.createObjectURL(file),
            attendee_id: match ? match.attendee_id : '',
            label: split || fromScanner ? cardLabel : defaultLabel(file.name, match),
          });
        });
      }
      setItems((prev) => [...prev, ...added]);
    } catch (e) {
      setError(`Couldn't read that file: ${e.message}`);
    } finally {
      setReading(false);
    }
  };

  // Scans ScanSmart saves while this is open drop straight into the list.
  useEffect(() => subscribeToScans((s) => {
    setScans(s);
    const fresh = s.pending.filter((scan) => !takenScans.current.has(scan.id));
    if (!fresh.length) return;
    fresh.forEach((scan) => takenScans.current.add(scan.id));
    addFiles(fresh.map((scan) => scan.file), { fromScanner: true });
    fresh.forEach((scan) => dismissScan(scan.id));
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the window stops scanning (nothing here would show a new scan) and releases the
  // previews' blob URLs.
  useEffect(() => () => {
    stopWatching();
    itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url));
  }, []);

  const update = (key, patch) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const remove = (key) => setItems((prev) => {
    const it = prev.find((x) => x.key === key);
    if (it) URL.revokeObjectURL(it.url);
    return prev.filter((x) => x.key !== key);
  });
  const toUpload = items.filter((it) => it.attendee_id);
  const assignedIds = new Set(toUpload.map((it) => it.attendee_id));

  const upload = async () => {
    setError('');
    if (toUpload.some((it) => !it.label.trim())) return setError('Every file needs a label.');
    setBusy(true);
    try {
      const result = await api.uploadAttendeeDocuments(session.session_id, toUpload);
      setDone(result.saved);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} maxWidth={900}>
      <div>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        <h2 style={{ paddingRight: 28 }}>Upload Attendee Documents</h2>
        {done !== null ? (
          <>
            <p className="success-banner">Saved {done} document{done === 1 ? '' : 's'} to the attendees&apos; profiles (Documents section).</p>
            <button type="button" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="page-subtitle" style={{ marginTop: 0 }}>
              Choose files (PDF, JPG or PNG) or scan the cards. A PDF with several cards in it is split into one card per page.
              Files with a name in the file name are matched for you - pick who each card belongs to, then upload.
              They&apos;re filed under each person&apos;s Documents{session.master_training_id ? `, linked to ${session.training_type_label}` : ''}.
            </p>
            {error && <div className="error-banner">{error}</div>}
            {scans.error && <div className="error-banner">{scans.error}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <label className="file-picker-button">
                Choose Files
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              {scanFolderSupported && (scans.watching
                ? <button type="button" className="secondary" onClick={stopWatching}>Stop scanning</button>
                : <button type="button" className="secondary" onClick={() => startWatching()}>Start scanning</button>)}
              <select value={pagesPerCard} onChange={(e) => setPagesPerCard(Number(e.target.value))} style={{ width: 'auto' }} title="How a PDF of several cards is split">
                <option value={1}>1 page per card (front only)</option>
                <option value={2}>2 pages per card (front + back)</option>
              </select>
              {reading && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Reading file…</span>}
            </div>
            {scans.watching && (
              <div style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, background: 'var(--status-current-bg)', marginBottom: 10 }}>
                Scanning on - new scans from <b>{scans.folderName}</b> are added below.
              </div>
            )}
            {items.length > 0 && (
              <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Card</th><th>Attendee</th><th>Label</th><th /></tr></thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.key}>
                        <td>
                          <CardPreview item={it} />
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', maxWidth: 240, overflowWrap: 'anywhere' }}>{it.file.name}</div>
                        </td>
                        <td>
                          <select value={it.attendee_id} onChange={(e) => update(it.key, { attendee_id: e.target.value })}>
                            <option value="">- Skip this file -</option>
                            {attendees.map((a) => (
                              <option key={a.attendee_id} value={a.attendee_id}>
                                {assignedIds.has(a.attendee_id) && a.attendee_id !== it.attendee_id ? '✓ ' : ''}{a.trainee_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td><input value={it.label} onChange={(e) => update(it.key, { label: e.target.value })} /></td>
                        <td><button type="button" className="link-button" onClick={() => remove(it.key)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 0 && (
              <p className="page-subtitle" style={{ margin: '8px 0 0' }}>
                {assignedIds.size} of {attendees.length} attendees have a card
                {items.length !== toUpload.length ? ` · ${items.length - toUpload.length} file(s) without an attendee will be skipped` : ''}.
                {' '}✓ in the list = already given a card.
              </p>
            )}
            <div style={{ marginTop: 12 }}>
              <button type="button" disabled={busy || reading || !toUpload.length} onClick={upload}>
                {busy ? 'Uploading…' : `Upload ${toUpload.length || ''} Document${toUpload.length === 1 ? '' : 's'}`}
              </button>{' '}
              <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
