import { useEffect, useState } from 'react';
import { api } from '../api';
import { nameAppearsIn, readCard } from '../lib/cardReader.js';
import {
  dismissScan, scanFolderSupported, startWatching, stopWatching, subscribeToScans,
} from '../lib/scanFolderWatcher.js';

// The training picked for the last saved scan carries over to the next one (even on the next
// employee), so a stack of the same card goes training-pick-free; still only offered when this
// employee actually has that training.
let lastTrainingId = '';

const defaultLabel = (training) => (training ? `${training.training_name} Card` : '');

function PendingScan({ scan, employeeId, employeeName, trainingOptions, onSaved }) {
  const initial = trainingOptions.find((t) => t.training_id === lastTrainingId)
    || (trainingOptions.length === 1 ? trainingOptions[0] : null);
  const [trainingId, setTrainingId] = useState(initial?.training_id || '');
  const [label, setLabel] = useState(defaultLabel(initial));
  const [labelEdited, setLabelEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // undefined while loading; the preview is drawn as an image (see lib/cardReader.js).
  const [card, setCard] = useState(undefined);

  useEffect(() => {
    let live = true;
    readCard(scan.file).then((c) => live && setCard(c)).catch(() => live && setCard({ preview: null, text: '' }));
    return () => { live = false; };
  }, [scan.file]);

  // Only when the scan has text to check (a searchable PDF) and this employee's name isn't in it.
  const nameMissing = card?.text?.trim() && !nameAppearsIn(employeeName, card.text);

  const pickTraining = (id) => {
    setTrainingId(id);
    if (!labelEdited) setLabel(defaultLabel(trainingOptions.find((t) => t.training_id === id)));
  };

  const save = async () => {
    if (!trainingId) return setError('Pick the training this card belongs to.');
    if (!label.trim()) return setError('Enter a label for this card.');
    setSaving(true);
    setError('');
    try {
      await api.uploadEmployeeDocument(employeeId, scan.file, label.trim(), trainingId);
      lastTrainingId = trainingId;
      dismissScan(scan.id);
      onSaved(`Saved "${label.trim()}" to ${employeeName}.`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 12, border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 10 }}>
      <a href={scan.url} target="_blank" rel="noreferrer" title="Open full size" style={{ flex: '0 0 220px', maxWidth: '100%' }}>
        {card?.preview
          ? <img src={card.preview} alt={scan.name} style={{ width: '100%', maxHeight: 160, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff' }} />
          : (
            <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
              {card === undefined ? 'Loading preview…' : 'No preview - click to open'}
            </div>
          )}
      </a>
      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>New scan: {scan.name}</div>
        {nameMissing && (
          <div style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, background: 'var(--status-missing-bg)', color: 'var(--status-missing-text)' }}>
            Couldn&apos;t find {employeeName}&apos;s name on this card - make sure it&apos;s theirs.
          </div>
        )}
        {error &&<div className="error-banner" style={{ margin: 0 }}>{error}</div>}
        <select value={trainingId} onChange={(e) => pickTraining(e.target.value)}>
          <option value="">{trainingOptions.length ? 'Which training is this card for?' : 'No trainings on their profile yet - add the training first'}</option>
          {trainingOptions.map((t) => <option key={t.training_id} value={t.training_id}>{t.training_id} - {t.training_name}</option>)}
        </select>
        <input
          type="text"
          placeholder="Label, e.g. OSHA 10 Card"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelEdited(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" disabled={saving} onClick={() => dismissScan(scan.id)}>Skip</button>
          <button type="button" disabled={saving || !trainingId} onClick={save}>
            {saving ? 'Saving...' : `Save to ${employeeName}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Scan cards" bar on an employee's Documents card: once started, every scan ScanSmart saves to
// the picked folder appears here to be labeled, attached to a training, and saved to whoever's
// page is open.
export default function ScanInbox({ employeeId, employeeName, trainingOptions, onSaved }) {
  const [scans, setScans] = useState({ folderName: '', watching: false, pending: [], error: '' });
  const [message, setMessage] = useState('');

  useEffect(() => subscribeToScans(setScans), []);
  useEffect(() => { setMessage(''); }, [employeeId]);

  if (!scanFolderSupported) return null;

  const saved = (text) => { setMessage(text); onSaved(); };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', borderRadius: 8,
        background: scans.watching ? 'var(--status-current-bg)' : 'var(--status-na-bg)',
      }}>
        <span style={{ flexGrow: 1, fontSize: 13 }}>
          {scans.watching
            ? <>Scanning on - new scans from <b>{scans.folderName}</b> will be saved to <b>{employeeName}</b>.</>
            : 'Scan cards straight onto this employee: start scanning, then scan with the Epson.'}
        </span>
        {scans.watching ? (
          <button type="button" className="secondary" onClick={stopWatching}>Stop scanning</button>
        ) : (
          <>
            {scans.folderName && (
              <button type="button" className="link-button" onClick={() => startWatching({ pickNew: true })}>Change folder</button>
            )}
            <button type="button" onClick={() => startWatching()} title={scans.folderName ? `Watches ${scans.folderName}` : 'Pick the folder ScanSmart saves to'}>
              Start scanning
            </button>
          </>
        )}
      </div>
      {scans.error && <div className="error-banner" style={{ marginTop: 8 }}>{scans.error}</div>}
      {message && <div style={{ fontSize: 13, color: 'var(--status-current-text)', marginTop: 8 }}>{message}</div>}
      {scans.pending.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {scans.pending.map((scan) => (
            <PendingScan
              key={`${scan.id}-${employeeId}`}
              scan={scan}
              employeeId={employeeId}
              employeeName={employeeName}
              trainingOptions={trainingOptions}
              onSaved={saved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
