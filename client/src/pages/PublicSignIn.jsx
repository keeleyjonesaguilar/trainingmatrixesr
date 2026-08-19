import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import SignaturePad from '../components/SignaturePad';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PublicSignIn() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('trainee'); // "trainee" | "trainer"
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [justSigned, setJustSigned] = useState(false);
  const [closedNow, setClosedNow] = useState(false);
  const sigRef = useRef(null);

  const load = () => {
    api
      .publicSessionInfo(token)
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  };

  useEffect(load, [token]);

  const handleTraineeSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) return setFormError('Please enter your name.');
    if (sigRef.current?.isEmpty()) return setFormError('Please sign before submitting.');
    setSubmitting(true);
    try {
      await api.publicSignIn(token, {
        trainee_name: name.trim(),
        trainee_phone: phone.trim(),
        signature: sigRef.current.toDataURL(),
      });
      setJustSigned(true);
      setName('');
      setPhone('');
      sigRef.current?.clear();
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrainerClose = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!trainerName.trim()) return setFormError("Please enter the trainer's name.");
    if (sigRef.current?.isEmpty()) return setFormError('Trainer signature is required to close the session.');
    setSubmitting(true);
    try {
      await api.publicCloseSession(token, {
        trainer_signed_name: trainerName.trim(),
        signature: sigRef.current.toDataURL(),
      });
      setClosedNow(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
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

  const isClosed = info.status === 'closed' || closedNow;

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>{info.training_type_label}</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {info.client_name} · {formatDate(info.session_date)}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>Trainer: {info.trainer_name}</div>
        </div>

        {info.outline && (
          <div className="card" style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 13 }}>Today's outline</strong>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{info.outline}</p>
          </div>
        )}

        {isClosed ? (
          <div className="card">
            <p className="success-banner" style={{ margin: 0 }}>
              {closedNow
                ? 'Session closed. Thank you — the roster and certificates have been generated.'
                : 'This training session has been closed and is no longer accepting sign-ins.'}
            </p>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={mode === 'trainee' ? 'btn' : 'btn btn-secondary'}
                onClick={() => {
                  setMode('trainee');
                  setFormError('');
                }}
              >
                I'm signing in
              </button>
              <button
                type="button"
                className={mode === 'trainer' ? 'btn btn-accent' : 'btn btn-secondary'}
                onClick={() => {
                  setMode('trainer');
                  setFormError('');
                }}
              >
                I'm the trainer — close session
              </button>
            </div>

            {formError && <p className="error-banner">{formError}</p>}

            {justSigned && mode === 'trainee' && (
              <p className="success-banner">You're signed in! Pass the phone to the next person, or scan again.</p>
            )}

            {mode === 'trainee' ? (
              <form onSubmit={handleTraineeSubmit}>
                <div className="field">
                  <label>Full name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
                </div>
                <div className="field">
                  <label>Phone number</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div className="field">
                  <label>Signature</label>
                  <SignaturePad ref={sigRef} />
                </div>
                <button className="btn btn-accent" type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
                  {info.attendee_count} {info.attendee_count === 1 ? 'person has' : 'people have'} signed in so far.
                </p>
              </form>
            ) : (
              <form onSubmit={handleTrainerClose}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Only close the session once everyone has signed in — the roster locks immediately and
                  certificates are generated automatically.
                </p>
                <div className="field">
                  <label>Trainer name</label>
                  <input
                    value={trainerName}
                    onChange={(e) => setTrainerName(e.target.value)}
                    placeholder={info.trainer_name}
                  />
                </div>
                <div className="field">
                  <label>Trainer signature</label>
                  <SignaturePad ref={sigRef} />
                </div>
                <button className="btn btn-danger" type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? 'Closing…' : `Close Session (${info.attendee_count} signed in)`}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
