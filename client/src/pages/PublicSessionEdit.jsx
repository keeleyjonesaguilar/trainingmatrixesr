// The trainer's post-close "Edit close-out details" page (Keeley's request, 2026-09-24), reached
// from the link in their close-out email at /session-edit/:editToken. No login - the trainer PIN
// unlocks it (server/routes/sessionEdit.js). Lets them fill in sign-off details they didn't have
// at close-out (e.g. the AHA roster's address), remove duplicate sign-ins, and add people they
// notice are missing from the final roster (2026-10-01); saving rebuilds the rosters and re-sends
// the completed forms email.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import AhaRosterFields, { ahaFieldsFromSaved, ahaFieldsPayload } from '../components/AhaRosterFields';
import { formatEasternDateTime } from '../lib/dates';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(d) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!match) return d || '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Attendee IDs that share a name or phone number with another sign-in on this session - the
// usual sign of someone signing in twice.
function likelyDuplicateIds(attendees) {
  const groups = new Map();
  for (const a of attendees) {
    const keys = [`name:${(a.trainee_name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`];
    const phone = (a.trainee_phone || '').replace(/\D/g, '');
    if (phone) keys.push(`phone:${phone}`);
    for (const key of keys) groups.set(key, [...(groups.get(key) || []), a.attendee_id]);
  }
  const ids = new Set();
  for (const group of groups.values()) if (group.length > 1) group.forEach((id) => ids.add(id));
  return ids;
}

export default function PublicSessionEdit() {
  const { editToken } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [pin, setPin] = useState('');
  const [details, setDetails] = useState(null);
  const [trainerEmail, setTrainerEmail] = useState('');
  const [trainerPhone, setTrainerPhone] = useState('');
  const [ahaFields, setAhaFields] = useState(null);
  const [toRemove, setToRemove] = useState([]);
  // People to add who aren't on the roster - name required, the rest optional; multi-day sessions
  // also pick which days they attended (all ticked to start).
  const blankDraft = (days) => ({ first_name: '', last_name: '', phone: '', job_title: '', email: '', days: (days || []).map((d) => d.day_number) });
  const [toAdd, setToAdd] = useState([]);
  const [draft, setDraft] = useState(blankDraft(null));
  const [draftError, setDraftError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    api.sessionEditInfo(editToken).then(setInfo).catch((err) => setLoadError(err.message));
  }, [editToken]);

  const showDetails = (data) => {
    setDetails(data);
    setTrainerEmail(data.trainer_email);
    setTrainerPhone(data.trainer_phone);
    setAhaFields(ahaFieldsFromSaved(data.aha));
    setToRemove([]);
    setToAdd([]);
    setDraft(blankDraft(data.days));
    setDraftError('');
  };

  const addDraft = () => {
    setDraftError('');
    setSavedMessage('');
    if (!draft.first_name.trim() || !draft.last_name.trim()) return setDraftError('Enter their first and last name.');
    if (draft.email.trim() && !EMAIL_PATTERN.test(draft.email.trim())) return setDraftError("That email doesn't look right.");
    if (details.days && !draft.days.length) return setDraftError(details.multi_training_day ? 'Tick the trainings they attended.' : 'Tick the days they attended.');
    setToAdd((prev) => [...prev, { ...draft, key: `${Date.now()}-${prev.length}` }]);
    setDraft(blankDraft(details.days));
    return undefined;
  };

  const changeSummary = [toAdd.length ? `add ${toAdd.length}` : '', toRemove.length ? `remove ${toRemove.length}` : ''].filter(Boolean).join(', ');

  const toggleDraftDay = (day) => setDraft((d) => ({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort((a, b) => a - b) }));

  const duplicateIds = useMemo(() => likelyDuplicateIds(details?.attendees || []), [details]);

  const unlock = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!pin.trim()) return setFormError('Enter your trainer PIN.');
    setBusy(true);
    try {
      showDetails(await api.sessionEditUnlock(editToken, pin.trim()));
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRemove = (attendeeId) => {
    setSavedMessage('');
    setToRemove((prev) => (prev.includes(attendeeId) ? prev.filter((id) => id !== attendeeId) : [...prev, attendeeId]));
  };

  const save = async (e) => {
    e.preventDefault();
    setFormError('');
    setSavedMessage('');
    if (!trainerEmail.trim() || !EMAIL_PATTERN.test(trainerEmail.trim())) return setFormError('Please enter a valid email address.');
    if (!trainerPhone.trim()) return setFormError('Please enter your phone number.');
    if (draft.first_name.trim() || draft.last_name.trim()) {
      return setFormError(`You started adding ${`${draft.first_name} ${draft.last_name}`.trim()} - click "Add to roster" or clear the name first.`);
    }
    if (toRemove.length) {
      const names = details.attendees.filter((a) => toRemove.includes(a.attendee_id)).map((a) => a.trainee_name).join(', ');
      const ok = window.confirm(
        `Remove ${toRemove.length} sign-in${toRemove.length === 1 ? '' : 's'} (${names})?\n\n` +
        'Their certificate and the training record it added to their employee file will be deleted.'
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await api.sessionEditSave(editToken, {
        pin: pin.trim(),
        trainer_email: trainerEmail.trim(),
        trainer_phone: trainerPhone.trim(),
        ...(details.is_aha ? ahaFieldsPayload(ahaFields) : {}),
        remove_attendee_ids: toRemove,
        add_attendees: toAdd.map(({ key, ...a }) => a),
      });
      showDetails(result);
      setSavedMessage(`Saved${result.added_count ? ` - added ${result.added_count} ${result.added_count === 1 ? 'person' : 'people'}` : ''}. The updated roster and certificates have been emailed to you and the ESR team.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="public-shell">
        <div className="public-card card">
          <p className="error-banner">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="public-shell">
        <div className="public-card">Loading…</div>
      </div>
    );
  }

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>Edit Close-Out Details</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {info.training_type_label} · {info.client_name} · {formatDate(info.session_date)}
          </div>
        </div>

        {info.status !== 'closed' ? (
          <div className="card">
            <p className="error-banner" style={{ margin: 0 }}>
              This session hasn&apos;t been closed yet. Use the sign-in page to close it out first.
            </p>
          </div>
        ) : !details ? (
          <div className="card">
            {formError && <p className="error-banner">{formError}</p>}
            <form onSubmit={unlock}>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
                Enter the trainer PIN you used to close this session.
              </p>
              <div className="field">
                <label>Trainer PIN</label>
                <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" autoComplete="off" placeholder="PIN" autoFocus />
              </div>
              <button className="btn btn-accent" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={save}>
            {savedMessage && <p className="success-banner">{savedMessage}</p>}
            {formError && <p className="error-banner">{formError}</p>}

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Trainer</h3>
              <div className="field">
                <label>Name</label>
                <input value={details.trainer_signed_name} disabled />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={trainerEmail} onChange={(e) => setTrainerEmail(e.target.value)} type="email" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Phone</label>
                <input value={trainerPhone} onChange={(e) => setTrainerPhone(e.target.value)} placeholder="(555) 123-4567" />
              </div>
            </div>

            {details.is_aha && <AhaRosterFields value={ahaFields} onChange={setAhaFields} />}

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Attendees ({details.attendees.length})</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6 }}>
                Signed in twice by mistake? Remove the extra entry. Possible duplicates (same name or phone) are flagged.
              </p>
              {details.attendees.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No attendees.</p>}
              {details.attendees.map((a) => {
                const removing = toRemove.includes(a.attendee_id);
                return (
                  <div
                    key={a.attendee_id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                      borderTop: '1px solid var(--color-border)', opacity: removing ? 0.55 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, textDecoration: removing ? 'line-through' : 'none' }}>
                        {a.trainee_name}
                        {duplicateIds.has(a.attendee_id) && !removing && (
                          <span className="badge badge-expiringsoon" style={{ marginLeft: 6, fontSize: 10 }}>Possible duplicate</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                        {[a.trainee_phone, a.trainee_email].filter(Boolean).join(' · ') || 'No phone or email'}
                        {' · '}Signed in {formatEasternDateTime(a.signed_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm ${removing ? 'btn-secondary' : 'btn-danger'}`}
                      onClick={() => toggleRemove(a.attendee_id)}
                    >
                      {removing ? 'Undo' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Add someone who&apos;s missing</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6 }}>
                Someone attended but isn&apos;t on the roster? Add them here - they get a certificate and the training on their record
                {details.multi_training_day ? ' for each training ticked' : details.days ? ' when every day is ticked' : ''}.
              </p>
              {toAdd.map((a) => (
                <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{a.first_name} {a.last_name} <span className="badge badge-current" style={{ fontSize: 10, marginLeft: 4 }}>To add</span></div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                      {[a.phone, a.job_title, a.email].filter(Boolean).join(' · ') || 'No other details'}
                      {details.multi_training_day
                        ? ` · ${a.days.map((n) => details.days.find((d) => d.day_number === n)?.label).join(', ')}`
                        : details.days ? ` · Day${a.days.length === 1 ? '' : 's'} ${a.days.join(', ')}` : ''}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setToAdd((prev) => prev.filter((x) => x.key !== a.key))}>Remove</button>
                </div>
              ))}
              {draftError && <p className="error-banner" style={{ marginTop: 8 }}>{draftError}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>First name</label>
                  <input value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Last name</label>
                  <input value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Phone (optional)</label>
                  <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="(555) 123-4567" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Job title (optional)</label>
                  <input value={draft.job_title} onChange={(e) => setDraft({ ...draft, job_title: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <label>Email (optional)</label>
                  <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
              </div>
              {details.days && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                    {details.multi_training_day ? 'Trainings attended' : 'Days attended'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                    {details.days.map((d) => (
                      <label key={d.day_number} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={draft.days.includes(d.day_number)} onChange={() => toggleDraftDay(d.day_number)} />
                        {d.label || <>Day {d.day_number}{d.date ? ` (${formatDate(d.date)})` : ''}</>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={addDraft}>+ Add to roster</button>
            </div>

            <button className="btn btn-accent" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Saving…' : changeSummary ? `Save Changes (${changeSummary})` : 'Save Changes'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 10 }}>
              Saving rebuilds the roster{details.is_aha ? ' and AHA roster' : ''} and emails the updated forms.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
