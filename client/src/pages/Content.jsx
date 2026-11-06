import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { TrainingMultiSearchSelect } from '../components/TrainingSearchSelect.jsx';
import { matchesSearch } from '../lib/search.js';
import { formatEasternDateTime } from '../lib/dates';
import { daysWithoutDecks } from '../lib/courseDecks';

// The Content page (Setup menu, Keeley's "Training matrix features 11.6", 2026-11-06): every
// PowerPoint, which training types use it, and which slides are flagged as needing an update.
// Trainers download these from their class summary email / Training Portal with the class's QR
// slides added - no more WeTransfer.

export function fileSize(bytes) {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function UploadDeckForm({ trainings, onUploaded, onCancel }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [trainingIds, setTrainingIds] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Choose a PowerPoint (.pptx) to upload.'); return; }
    setError('');
    setProgress(0);
    try {
      const created = await api.createDeck(file, { name: name.trim(), trainingIds }, setProgress);
      onUploaded(created);
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  };

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Upload a PowerPoint</h3>
      <p className="page-subtitle" style={{ marginTop: 0 }}>
        Build the deck in PowerPoint and save it as .pptx. Don&apos;t add sign-in or feedback QR codes - every class download gets its own
        Sign-In QR slide at the start and Feedback QR slide at the end automatically.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-grid-2">
        <div className="field">
          <label>PowerPoint file (.pptx)</label>
          <input
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.pptx$/i, ''));
            }}
            disabled={progress !== null}
          />
        </div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fall Protection" disabled={progress !== null} />
        </div>
      </div>
      <div className="field">
        <label>Used for these training types</label>
        <TrainingMultiSearchSelect trainings={trainings} value={trainingIds} onChange={setTrainingIds} />
        <p className="page-subtitle" style={{ margin: '4px 0 0' }}>You can change this later too, here or on each Training Type&apos;s settings.</p>
      </div>
      {progress !== null && (
        <div className="deck-upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${progress}%` }} />
          <span>{progress < 100 ? `Uploading… ${progress}%` : 'Reading the slides…'}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={progress !== null}>{progress !== null ? 'Uploading…' : 'Upload'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={progress !== null}>Cancel</button>
      </div>
    </form>
  );
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'flagged', label: 'Needs update' },
  { value: 'unused', label: 'Not used by a training' },
];

export default function Content() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [decks, setDecks] = useState(null);
  const [trainings, setTrainings] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listDecks().then(setDecks).catch((e) => setError(e.message));
    api.listMasterTrainings().then(setTrainings).catch(() => {});
  }, []);

  const shown = useMemo(() => (decks || []).filter((d) => {
    if (filter === 'flagged' && !d.flagged_count) return false;
    if (filter === 'unused' && (d.used_by.length || d.used_on_days?.length)) return false;
    if (search && !matchesSearch(`${d.name} ${[...d.used_by, ...(d.used_on_days || [])].map((u) => u.training_name).join(' ')}`, search)) return false;
    return true;
  }), [decks, filter, search]);

  // Active training types with no PowerPoint. A multi-day course needs no main PowerPoint - only
  // the days with none picked are listed (2026-11-06).
  const missing = useMemo(() => trainings.filter((t) => t.active).map((t) => {
    if (Number(t.default_total_days) >= 2) {
      const days = daysWithoutDecks(t, trainings);
      return days.length ? { ...t, note: `multi-day course - no PowerPoint picked yet for Day ${days.join(', ')}` } : null;
    }
    return t.deck_id ? null : t;
  }).filter(Boolean), [trainings]);
  const flaggedTotal = (decks || []).reduce((n, d) => n + d.flagged_count, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Content</h1>
          <p className="page-subtitle">
            Every training PowerPoint in one place. Trainers download the ones for their class from the class summary email and the
            Training Portal - with that class&apos;s Sign-In and Feedback QR slides already added.
          </p>
        </div>
        {isAdmin && !uploading && (
          <div className="page-header-actions">
            <button onClick={() => setUploading(true)}>+ Upload PowerPoint</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {uploading && (
        <UploadDeckForm
          trainings={trainings}
          onUploaded={(created) => navigate(`/content/${created.deck_id}`)}
          onCancel={() => setUploading(false)}
        />
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search PowerPoints or training types…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
        <div className="deck-filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`deck-chip${filter === f.value ? ' active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}{f.value === 'flagged' && flaggedTotal ? ` (${flaggedTotal})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {!decks ? <LoadingState label="Loading PowerPoints..." /> : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PowerPoint</th>
                  <th>Used for</th>
                  <th>Slides</th>
                  <th>Needs update</th>
                  <th>Last uploaded</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.deck_id}>
                    <td>
                      <Link to={`/content/${d.deck_id}`}><strong>{d.name}</strong></Link>
                      {d.file_missing && <div><span className="badge badge-expired">File missing - upload it again</span></div>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {d.used_by.map((u) => <div key={u.training_id}><Link to={`/training-types/${u.training_id}`}>{u.training_name}</Link></div>)}
                      {(d.used_on_days || []).map((u) => (
                        <div key={`days-${u.training_id}`}>
                          <Link to={`/training-types/${u.training_id}`}>{u.training_name}</Link>
                          <span style={{ color: 'var(--color-text-muted)' }}> · Day {u.days.join(', ')}</span>
                        </div>
                      ))}
                      {!d.used_by.length && !d.used_on_days?.length && <span style={{ color: 'var(--color-text-muted)' }}>Not used yet</span>}
                    </td>
                    <td>
                      {d.slide_count}
                      {d.hidden_count > 0 && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{d.hidden_count} hidden</div>}
                    </td>
                    <td>
                      {d.flagged_count
                        ? <span className="badge badge-expiringsoon">⚑ {d.flagged_count} slide{d.flagged_count === 1 ? '' : 's'}</span>
                        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {d.uploaded_at ? formatEasternDateTime(d.uploaded_at) : '—'}
                      {d.uploaded_by && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>by {d.uploaded_by}</div>}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      {decks.length ? 'No PowerPoints match.' : 'No PowerPoints yet. Upload the first one with "+ Upload PowerPoint".'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14 }}>Trainings that still need a PowerPoint ({missing.length})</h3>
              <p className="page-subtitle" style={{ margin: '2px 0 0' }}>
                If one of these is scheduled, its trainer gets no PowerPoint to download. To fix one, upload its PowerPoint
                with <strong>+ Upload PowerPoint</strong> and pick the training under <strong>Used for</strong>. For a multi-day
                course like OSHA, open the course and pick each day&apos;s PowerPoints under <strong>Edit days</strong>.
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowMissing((v) => !v)}>{showMissing ? 'Hide' : 'Show'}</button>
          </div>
          {showMissing && (
            <ul className="deck-missing-list">
              {missing.map((t) => (
                <li key={t.training_id}>
                  <Link to={`/training-types/${t.training_id}`}>{t.training_name}</Link>
                  {t.note && <span style={{ color: 'var(--color-text-muted)' }}> - {t.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
