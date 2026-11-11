import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { TrainingMultiSearchSelect } from '../components/TrainingSearchSelect.jsx';
import { formatEasternDateTime } from '../lib/dates';
import { fileSize } from './Content.jsx';
import { useSlidePictures } from '../lib/slidePictures';

// One PowerPoint on the Content page (Keeley's "Training matrix features 11.6", 2026-11-06): its
// slides as cards to put in order (drag, or the arrows), hide from the slideshow, give a
// transition, label, and flag as needing an update with a note. Changes are kept on the page until
// Save, then every download (Content page and class downloads) is built that way. The deck itself
// is edited in PowerPoint and uploaded again as a new version.

const SLIDE_FIELDS = ['hidden', 'transition', 'label', 'flagged', 'flag_note'];
const TRANSITION_NAMES = { fade: 'Fade', push: 'Push', wipe: 'Wipe', split: 'Split', cover: 'Cover', cut: 'Cut', on: 'On', morph: 'Morph', prstTrans: 'newer PowerPoint effect' };

function sameSlides(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i].id && SLIDE_FIELDS.every((f) => (s[f] ?? '') === (b[i][f] ?? '')));
}

function fileTransitionName(value) {
  if (!value) return 'none';
  return TRANSITION_NAMES[value] || value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function SlideCard({
  deckId, slide, index, total, isAdmin, transitions, onChange, onMove, dragging, onDragStart, onDragOver, onDrop, onDragEnd,
  picture, picturesLoading, aspect, onEnlarge,
}) {
  const [showText, setShowText] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const set = (field, value) => onChange(slide.id, { [field]: value });
  return (
    <div
      className={`deck-slide${slide.hidden ? ' is-hidden' : ''}${slide.flagged ? ' is-flagged' : ''}${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => { if (isAdmin) { e.preventDefault(); onDragOver(index); } }}
      onDrop={(e) => { e.preventDefault(); onDrop(index); }}
    >
      <div className="deck-slide-order">
        {isAdmin && (
          <span
            className="deck-slide-handle"
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', slide.id); onDragStart(index); }}
            onDragEnd={onDragEnd}
            title="Drag to move"
            aria-hidden="true"
          >⋮⋮</span>
        )}
        <span className="deck-slide-number">{index + 1}</span>
        {isAdmin && (
          <span className="deck-slide-arrows">
            <button type="button" className="link-button" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`Move slide ${index + 1} up`}>▲</button>
            <button type="button" className="link-button" onClick={() => onMove(index, index + 1)} disabled={index === total - 1} aria-label={`Move slide ${index + 1} down`}>▼</button>
          </span>
        )}
      </div>

      <div className="deck-slide-picture" style={aspect ? { aspectRatio: aspect } : undefined}>
        {/* The real slide (migration 093); until it's ready, its biggest picture or its title. */}
        {picture ? (
          <button type="button" className="deck-slide-picture-btn" onClick={onEnlarge} title="See it bigger" aria-label={`See slide ${index + 1} bigger`}>
            <img src={picture} alt={`Slide ${index + 1}`} />
          </button>
        ) : picturesLoading ? <div className="deck-slide-picture-text">Loading picture…</div>
          : slide.has_picture && !pictureFailed
            ? <img src={api.deckSlidePictureUrl(deckId, slide.id)} alt="" loading="lazy" onError={() => setPictureFailed(true)} />
            : <div className="deck-slide-picture-text">{slide.title || 'No text on this slide'}</div>}
        {slide.hidden && <span className="deck-slide-tag">Hidden</span>}
      </div>

      <div className="deck-slide-main">
        {/* The slide's name: its PowerPoint title until it's renamed here (Keeley, 2026-11-06).
            Renaming only changes the name in the app - the words on the slide are edited in PowerPoint. */}
        {isAdmin ? (
          <input
            className="deck-slide-title-input"
            value={slide.label || slide.title || ''}
            onChange={(e) => set('label', e.target.value === (slide.title || '') ? '' : e.target.value)}
            placeholder="Name this slide"
            aria-label={`Slide ${index + 1} name`}
          />
        ) : (
          <div className="deck-slide-title">{slide.label || slide.title || <em style={{ color: 'var(--color-text-muted)' }}>No title</em>}</div>
        )}
        {slide.label && slide.title && slide.label !== slide.title && (
          <div className="deck-slide-meta">
            Title on the slide: {slide.title}
            {isAdmin && <> · <button type="button" className="link-button" style={{ padding: 0, fontSize: 11 }} onClick={() => set('label', '')}>Use this</button></>}
          </div>
        )}
        {(slide.body_text || slide.notes_text) && (
          <button type="button" className="link-button" style={{ padding: 0, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => setShowText((v) => !v)}>
            {showText ? 'Hide slide text' : 'Show slide text'}{slide.notes_text ? ' & notes' : ''}
          </button>
        )}
        {showText && (
          <div className="deck-slide-text">
            {slide.body_text && <div style={{ whiteSpace: 'pre-line' }}>{slide.body_text}</div>}
            {slide.notes_text && (
              <div className="deck-slide-notes"><strong>Speaker notes:</strong> <span style={{ whiteSpace: 'pre-line' }}>{slide.notes_text}</span></div>
            )}
          </div>
        )}
        {slide.flagged && (
          <div className="deck-slide-flag">
            <strong>⚑ Needs update</strong>
            {isAdmin ? (
              <textarea
                rows={2}
                value={slide.flag_note || ''}
                onChange={(e) => set('flag_note', e.target.value)}
                placeholder="What needs updating? (e.g. new 2026 OSHA penalty amounts)"
                aria-label={`Slide ${index + 1} update note`}
              />
            ) : slide.flag_note && <div style={{ whiteSpace: 'pre-line' }}>{slide.flag_note}</div>}
            {slide.flagged_by && <div className="deck-slide-meta">Flagged by {slide.flagged_by}{slide.flagged_at ? ` · ${formatEasternDateTime(slide.flagged_at)}` : ''}</div>}
          </div>
        )}
      </div>

      <div className="deck-slide-controls">
        <label>
          <span>Transition</span>
          <select value={slide.transition || ''} onChange={(e) => set('transition', e.target.value || null)} disabled={!isAdmin}>
            <option value="">Keep from PowerPoint ({fileTransitionName(slide.file_transition)})</option>
            {transitions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="deck-slide-check">
          <input type="checkbox" checked={!!slide.hidden} onChange={(e) => set('hidden', e.target.checked)} disabled={!isAdmin} />
          <span>Hide in slideshow</span>
        </label>
        <label className="deck-slide-check">
          <input type="checkbox" checked={!!slide.flagged} onChange={(e) => onChange(slide.id, { flagged: e.target.checked })} disabled={!isAdmin} />
          <span>Needs update</span>
        </label>
      </div>
    </div>
  );
}

export default function ContentDeck() {
  const { id } = useParams();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [deck, setDeck] = useState(null);
  const [slides, setSlides] = useState(null);
  const [transitions, setTransitions] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [show, setShow] = useState('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessageText] = useState('');
  const messageTimer = useRef(null);
  // The green message says what was just saved, then goes away - so an older one is never left
  // showing after a different change (Keeley, 2026-11-06).
  const setMessage = (text) => {
    clearTimeout(messageTimer.current);
    setMessageText(text);
    if (text) messageTimer.current = setTimeout(() => setMessageText(''), 6000);
  };
  useEffect(() => () => clearTimeout(messageTimer.current), []);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [bigPicture, setBigPicture] = useState(null); // { index, url }
  const fileInput = useRef(null);
  const slidePictures = useSlidePictures(deck);

  const load = () => api.getDeck(id).then((d) => {
    setDeck(d);
    setSlides(d.slides);
    setName(d.name);
    setNotes(d.notes || '');
  }).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.getDeckTransitions().then(setTransitions).catch(() => {});
    api.listMasterTrainings().then(setTrainings).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dirty = deck && slides && !sameSlides(deck.slides, slides);

  // While the slide pictures are being made, check back every few seconds - only the picture
  // fields are taken, so unsaved slide changes on the page are left alone.
  const picturesPending = deck?.pictures === 'pending';
  useEffect(() => {
    if (!picturesPending) return undefined;
    const timer = setInterval(() => {
      api.getDeck(id).then((fresh) => setDeck((d) => (d ? {
        ...d, pictures: fresh.pictures, pictures_order: fresh.pictures_order, pictures_error: fresh.pictures_error,
      } : d))).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [picturesPending, id]);

  const remakePictures = async () => {
    setError('');
    try {
      await api.remakeSlidePictures(id);
      setDeck((d) => ({ ...d, pictures: 'pending', pictures_error: null, pictures_order: null }));
    } catch (e) {
      setError(e.message);
    }
  };

  const openBig = async (index, partName) => {
    setBigPicture({ index, url: slidePictures.pictures[partName] });
    try {
      const url = await slidePictures.enlarge(partName);
      if (url) setBigPicture((b) => (b && b.index === index ? { index, url } : b));
    } catch { /* keep the small one */ }
  };
  useEffect(() => {
    if (!bigPicture) return undefined;
    const close = (e) => { if (e.key === 'Escape') setBigPicture(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [bigPicture]);

  // Don't lose unsaved slide changes by closing the tab.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const changeSlide = (slideId, patch) => setSlides((prev) => prev.map((s) => (s.id === slideId ? { ...s, ...patch } : s)));
  const moveSlide = (from, to) => {
    if (to < 0 || to >= slides.length || from === to) return;
    setSlides((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.saveDeckSlides(id, slides.map((s) => ({
        id: s.id, hidden: s.hidden, transition: s.transition || null, label: s.label || '', flagged: s.flagged, flag_note: s.flag_note || '',
      })));
      await load();
      setMessage('Slide changes saved. Every download of this PowerPoint now uses them.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = async (data, okMessage) => {
    setError('');
    setMessage('');
    try {
      await api.updateDeck(id, data);
      const fresh = await api.getDeck(id);
      setDeck((d) => ({ ...fresh, slides: d.slides }));
      if (okMessage) setMessage(okMessage);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const uploadVersion = async (file) => {
    if (!file) return;
    if (dirty && !window.confirm('You have unsaved slide changes. Uploading a new version will drop them. Continue?')) return;
    setError('');
    setMessage('');
    setUploadProgress(0);
    try {
      const result = await api.uploadDeckVersion(id, file, setUploadProgress);
      await load();
      setMessage(`New version uploaded - ${result.slides} slides. ${result.carried ? `Labels, flags and transitions kept on ${result.carried} unchanged slide${result.carried === 1 ? '' : 's'}.` : ''} The order is the new file's.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restorePrevious = async () => {
    setMessage('');
    if (!window.confirm(`Go back to the previous version (${deck.previous_original_filename || 'earlier upload'}, uploaded ${formatEasternDateTime(deck.previous_uploaded_at)})? The current version becomes the "previous" one, so you can switch back.`)) return;
    try {
      await api.restorePreviousDeck(id);
      await load();
      setMessage('Switched back to the previous version.');
    } catch (e) {
      setError(e.message);
    }
  };

  const removePrevious = async () => {
    setMessage('');
    const size = deck.previous_file_size ? ` (${fileSize(deck.previous_file_size)})` : '';
    if (!window.confirm(`Remove the previous version (${deck.previous_original_filename || 'earlier upload'}, uploaded ${formatEasternDateTime(deck.previous_uploaded_at)})${size}? This frees up space on the server. You won't be able to go back to it - the current version stays as it is.`)) return;
    try {
      await api.removePreviousDeck(id);
      await load();
      setMessage(`Previous version removed${size ? ` - freed ${fileSize(deck.previous_file_size)}` : ''}.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    const uses = [
      ...deck.used_by.map((u) => u.training_name),
      ...(deck.used_on_days || []).map((u) => `${u.training_name} (Day ${u.days.join(', ')})`),
    ];
    const used = uses.length ? `\n\nIt's used by ${uses.join(', ')} - those trainers won't get it any more.` : '';
    if (!window.confirm(`Delete "${deck.name}"? This removes the file from the app.${used}`)) return;
    try {
      await api.deleteDeck(id);
      navigate('/content');
    } catch (e) {
      setError(e.message);
    }
  };

  const setAllTransitions = (value) => {
    if (!value) return;
    setSlides((prev) => prev.map((s) => ({ ...s, transition: value === 'keep' ? null : value })));
  };

  const shown = useMemo(() => (slides || []).map((s, i) => ({ s, i })).filter(({ s }) => (
    show === 'all' || (show === 'flagged' && s.flagged) || (show === 'hidden' && s.hidden)
  )), [slides, show]);

  if (error && !deck) return <div className="error-banner">{error}</div>;
  if (!deck || !slides) return <LoadingState label="Loading PowerPoint..." />;

  const flaggedCount = slides.filter((s) => s.flagged).length;
  const hiddenCount = slides.filter((s) => s.hidden).length;

  return (
    <div className="deck-page">
      <p style={{ margin: '0 0 8px' }}><Link to="/content">← Content</Link></p>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          {editingName ? (
            <form
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim() === deck.name) { setEditingName(false); return; }
                if (await saveDetails({ name: name.trim() }, `Renamed to "${name.trim()}".`)) setEditingName(false);
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 18, maxWidth: 420 }} autoFocus aria-label="PowerPoint name" />
              <button type="submit" className="btn btn-sm">Save</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setName(deck.name); setEditingName(false); }}>Cancel</button>
            </form>
          ) : (
            <h1>
              {deck.name}
              {isAdmin && <button type="button" className="link-button" style={{ fontSize: 13, marginLeft: 8 }} onClick={() => setEditingName(true)}>Rename</button>}
            </h1>
          )}
          <p className="page-subtitle">
            {slides.length} slides{hiddenCount ? ` · ${hiddenCount} hidden` : ''}{flaggedCount ? ` · ${flaggedCount} need${flaggedCount === 1 ? 's' : ''} update` : ''}
            {' · '}{deck.original_filename}{deck.file_size ? ` (${fileSize(deck.file_size)})` : ''}
            {deck.uploaded_at && ` · uploaded ${formatEasternDateTime(deck.uploaded_at)}${deck.uploaded_by ? ` by ${deck.uploaded_by}` : ''}`}
          </p>
        </div>
        <div className="page-header-actions" style={{ flexWrap: 'wrap' }}>
          {!deck.file_missing && <a className="btn btn-secondary" href={api.deckDownloadUrl(id)}>Download</a>}
          {isAdmin && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={uploadProgress !== null}>Upload new version</button>
              <input ref={fileInput} type="file" accept=".pptx" style={{ display: 'none' }} onChange={(e) => uploadVersion(e.target.files?.[0])} />
            </>
          )}
        </div>
      </div>

      {deck.file_missing && (
        <div className="error-banner">
          This PowerPoint&apos;s file isn&apos;t on this server (it was probably uploaded from a test computer). Use Upload new version to put it back - its slide settings will be kept.
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {/* Shown at the bottom of the screen, where the change was made, not up top out of view. */}
      {message && <div className="success-banner deck-toast" role="status">{message}</div>}
      {uploadProgress !== null && (
        <div className="deck-upload-progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${uploadProgress}%` }} />
          <span>{uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Reading the slides…'}</span>
        </div>
      )}

      <div className="deck-details">
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Used for</h3>
          {isAdmin ? (
            <TrainingMultiSearchSelect
              trainings={trainings}
              value={deck.used_by.map((u) => u.training_id)}
              onChange={(ids) => saveDetails({ training_ids: ids }, 'Saved which training types use this PowerPoint.')}
            />
          ) : deck.used_by.length
            ? deck.used_by.map((u) => <div key={u.training_id}><Link to={`/training-types/${u.training_id}`}>{u.training_name}</Link></div>)
            : <p className="page-subtitle" style={{ margin: 0 }}>Not used by a training type yet.</p>}
          <p className="page-subtitle" style={{ margin: '6px 0 0' }}>
            Trainers of these classes get this PowerPoint. A training type uses one PowerPoint - adding it here moves it off any other.
          </p>
          {deck.used_on_days?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <strong>Also used on multi-day course days:</strong>
              {deck.used_on_days.map((u) => (
                <div key={u.training_id}>
                  <Link to={`/training-types/${u.training_id}`}>{u.training_name}</Link>
                  <span style={{ color: 'var(--color-text-muted)' }}> · Day {u.days.join(', ')}</span>
                </div>
              ))}
              <p className="page-subtitle" style={{ margin: '4px 0 0' }}>Change these on the course&apos;s Training Type page.</p>
            </div>
          )}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Notes</h3>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (isAdmin && notes !== (deck.notes || '')) saveDetails({ notes }, 'Notes saved.'); }}
            placeholder="Anything the office should know about this deck (source, who maintains it, last review…)"
            disabled={!isAdmin}
            style={{ width: '100%' }}
          />
          {isAdmin && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              {deck.has_previous && (
                <button type="button" className="link-button" style={{ padding: 0 }} onClick={restorePrevious}>
                  Go back to previous version ({formatEasternDateTime(deck.previous_uploaded_at)})
                </button>
              )}
              {deck.has_previous && (
                <button type="button" className="link-button" style={{ padding: 0 }} onClick={removePrevious}>
                  Remove previous version{deck.previous_file_size ? ` (${fileSize(deck.previous_file_size)})` : ''}
                </button>
              )}
              <button type="button" className="link-button" style={{ padding: 0, color: 'var(--status-expired-text)' }} onClick={remove}>Delete PowerPoint</button>
            </div>
          )}
        </div>
      </div>

      <div className="card deck-toolbar">
        <div className="deck-filter-chips">
          {[['all', `All slides (${slides.length})`], ['flagged', `Needs update (${flaggedCount})`], ['hidden', `Hidden (${hiddenCount})`]].map(([value, label]) => (
            <button key={value} type="button" className={`deck-chip${show === value ? ' active' : ''}`} onClick={() => setShow(value)}>{label}</button>
          ))}
        </div>
        {isAdmin && (
          <label className="deck-all-transitions">
            <span>Transition for every slide</span>
            <select value="" onChange={(e) => setAllTransitions(e.target.value)}>
              <option value="">Choose…</option>
              <option value="keep">Keep from PowerPoint</option>
              {transitions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {deck.pictures === 'pending' && (
        <div className="deck-pictures-note">Making pictures of the slides… they&apos;ll show up here in a minute or two (longer for a big PowerPoint).</div>
      )}
      {(deck.pictures === 'failed' || slidePictures.state === 'unusable') && (
        <div className="deck-pictures-note is-problem">
          The slide pictures couldn&apos;t be made{deck.pictures_error ? ` (${deck.pictures_error})` : ''}, so the cards show each slide&apos;s biggest picture instead.
          {isAdmin && <> <button type="button" className="link-button" style={{ padding: 0 }} onClick={remakePictures}>Try again</button></>}
        </div>
      )}
      {deck.pictures === 'off' && (
        <div className="deck-pictures-note">Slide pictures are made on the live site - on this computer the cards show each slide&apos;s biggest picture.</div>
      )}
      {isAdmin && (
        <p className="page-subtitle" style={{ margin: '0 0 8px' }}>
          Click a slide&apos;s name to rename it here. To change the words on the slide itself, edit it in PowerPoint and use Upload new version.
        </p>
      )}
      {show !== 'all' && isAdmin && <p className="page-subtitle">Show all slides to drag them into a new order.</p>}

      <div className="deck-slides" onDragOver={(e) => e.preventDefault()}>
        {shown.map(({ s, i }) => (
          <SlideCard
            key={s.id}
            deckId={id}
            slide={s}
            index={i}
            total={slides.length}
            isAdmin={isAdmin}
            transitions={transitions}
            onChange={changeSlide}
            onMove={moveSlide}
            dragging={dragFrom === i}
            onDragStart={(index) => setDragFrom(index)}
            onDragOver={(index) => { if (show === 'all' && dragFrom !== null && dragFrom !== index) { moveSlide(dragFrom, index); setDragFrom(index); } }}
            onDrop={() => setDragFrom(null)}
            onDragEnd={() => setDragFrom(null)}
            picture={slidePictures.pictures[s.part_name]}
            picturesLoading={slidePictures.state === 'loading' || deck.pictures === 'pending'}
            aspect={deck.slide_width && deck.slide_height ? `${deck.slide_width} / ${deck.slide_height}` : null}
            onEnlarge={() => openBig(i, s.part_name)}
          />
        ))}
        {shown.length === 0 && <div className="card empty-state">No slides here.</div>}
      </div>

      {bigPicture && (
        <div className="deck-big-picture" role="dialog" aria-label={`Slide ${bigPicture.index + 1}`} onClick={() => setBigPicture(null)}>
          <img src={bigPicture.url} alt={`Slide ${bigPicture.index + 1}`} />
          <div className="deck-big-picture-caption">Slide {bigPicture.index + 1} · click anywhere or press Esc to close</div>
        </div>
      )}

      {isAdmin && dirty && (
        <div className="deck-save-bar">
          <span>You have unsaved changes to the slides.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setSlides(deck.slides)} disabled={saving}>Undo changes</button>
            <button type="button" className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
