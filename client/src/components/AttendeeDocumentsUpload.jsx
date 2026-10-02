import { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api';

// "Upload Attendee Documents" on a closed session (Keeley's request, 2026-10-02): choose several
// files at once (e.g. a CPR class's skills checklists, one per person), each is matched to an
// attendee by the name in its file name, you check or change the matches, and each file is filed
// under that person's Documents - server/routes/trainingSessions.js POST /:id/attendee-documents.

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

export default function AttendeeDocumentsUpload({ session, onClose, onDone }) {
  const attendees = (session.attendees || []).filter((a) => a.employee_id);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const addFiles = (fileList) => {
    setError('');
    const added = [...fileList].map((file, i) => {
      const match = matchAttendee(file.name, attendees);
      return { key: `${Date.now()}-${i}-${file.name}`, file, attendee_id: match ? match.attendee_id : '', label: defaultLabel(file.name, match) };
    });
    setItems((prev) => [...prev, ...added]);
  };
  const update = (key, patch) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toUpload = items.filter((it) => it.attendee_id);

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
    <Modal onClose={busy ? () => {} : onClose} maxWidth={780}>
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
              Choose one or more files (PDF, JPG or PNG). Each is matched to an attendee by the name in its file name - check the matches, then upload.
              They&apos;re filed under each person&apos;s Documents{session.master_training_id ? `, linked to ${session.training_type_label}` : ''}.
            </p>
            {error && <div className="error-banner">{error}</div>}
            <label className="file-picker-button" style={{ marginBottom: 10 }}>
              Choose Files
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {items.length > 0 && (
              <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>File</th><th>Attendee</th><th>Label</th><th /></tr></thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.key}>
                        <td style={{ fontSize: 12, maxWidth: 220, overflowWrap: 'anywhere' }}>{it.file.name}</td>
                        <td>
                          <select value={it.attendee_id} onChange={(e) => update(it.key, { attendee_id: e.target.value })}>
                            <option value="">- Skip this file -</option>
                            {attendees.map((a) => <option key={a.attendee_id} value={a.attendee_id}>{a.trainee_name}</option>)}
                          </select>
                        </td>
                        <td><input value={it.label} onChange={(e) => update(it.key, { label: e.target.value })} /></td>
                        <td><button type="button" className="link-button" onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 0 && items.length !== toUpload.length && (
              <p className="page-subtitle" style={{ margin: '8px 0 0' }}>{items.length - toUpload.length} file(s) without an attendee will be skipped.</p>
            )}
            <div style={{ marginTop: 12 }}>
              <button type="button" disabled={busy || !toUpload.length} onClick={upload}>
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
