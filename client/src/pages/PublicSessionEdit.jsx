// The trainer's post-close "Edit close-out details" page (Keeley's request, 2026-09-24), reached
// from the link in their close-out email at /session-edit/:editToken. No login - the trainer PIN
// unlocks it (server/routes/sessionEdit.js). Lets them fill in sign-off details they didn't have
// at close-out (e.g. the AHA roster's address) and remove duplicate sign-ins; saving rebuilds the
// rosters and re-sends the completed forms email.
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
  };

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
      });
      showDetails(result);
      setSavedMessage('Saved. The updated roster and certificates have been emailed to you and the ESR team.');
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

            <button className="btn btn-accent" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Saving…' : toRemove.length ? `Save Changes & Remove ${toRemove.length}` : 'Save Changes'}
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
