// The ESR Training Portal (Keeley's request, 2026-09-30) - /portal, for invited employees and
// trainers. Sign in with the email on your profile and a one-time code (no password); then see
// your trainings and certificates, keep your phone/email current, and - for trainers - what you
// teach and your rating averages. Backed by server/routes/portal.js.
import { useEffect, useState } from 'react';
import { api } from '../api';
import esrLogo from '../assets/brand/esr-logo-full.png';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatShortDate } from '../lib/dates';

function longDate(d) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!match) return d || '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function sessionDates(s) {
  if (s.day_dates?.length > 1) return `${formatShortDate(s.day_dates[0])} – ${formatShortDate(s.day_dates[s.day_dates.length - 1])} (${s.day_dates.length} days)`;
  return longDate(s.date);
}

function Shell({ onLogout, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--color-surface)', borderBottom: '3px solid var(--esr-gold)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={esrLogo} alt="Evolution Safety Resources" style={{ height: 38, width: 'auto' }} />
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--esr-gold-ink)' }}>
              Training Portal
            </span>
          </div>
          {onLogout && <button type="button" className="secondary" onClick={onLogout}>Sign Out</button>}
        </div>
      </header>
      <main style={{ maxWidth: 960, width: '100%', margin: '0 auto', padding: '24px 16px 48px', boxSizing: 'border-box', flex: 1 }}>
        {children}
      </main>
      <footer style={{ background: 'var(--esr-navy)', color: 'rgb(255 255 255 / 80%)', fontSize: 12, padding: '14px 16px', textAlign: 'center' }}>
        Evolution Safety Resources · ESR Training Portal
      </footer>
    </div>
  );
}

function SignIn({ onSignedIn }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter the email address on your ESR profile.');
    setBusy(true);
    try {
      await api.portalRequestCode(email.trim());
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.portalVerify(email.trim(), code.trim());
      onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: '32px auto' }}>
      <h1 style={{ fontSize: 22 }}>Sign in</h1>
      {error && <p className="error-banner">{error}</p>}
      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <p className="page-subtitle" style={{ marginBottom: 14 }}>Enter the email on your ESR profile. We&apos;ll email you a one-time code - no password needed.</p>
          <div className="field">
            <label htmlFor="portal-email">Email address</label>
            <input id="portal-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Email Me a Code'}</button>
          <p className="page-subtitle" style={{ margin: '14px 0 0', fontSize: 12 }}>The portal is invite-only. If you don&apos;t get a code, ask ESR to invite you or check the email on your profile.</p>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="page-subtitle" style={{ marginBottom: 14 }}>If <strong>{email.trim()}</strong> is set up for the portal, a 6-digit code is on its way. It works for 10 minutes.</p>
          <div className="field">
            <label htmlFor="portal-code">Code</label>
            <input id="portal-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus
              style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center', padding: '8px 10px' }} />
          </div>
          <button type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Sign In'}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button type="button" className="link-button" onClick={() => { setStep('email'); setCode(''); setError(''); }}>Use a different email</button>
            <button type="button" className="link-button" disabled={busy} onClick={sendCode}>Send a new code</button>
          </div>
        </form>
      )}
    </div>
  );
}

function ContactCard({ profile, accountEmail, onChanged }) {
  const [phone, setPhone] = useState(profile.phone);
  const [phoneMsg, setPhoneMsg] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailStep, setEmailStep] = useState('idle'); // idle | editing | code
  const [emailCode, setEmailCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const savePhone = async () => {
    setBusy(true); setError(''); setPhoneMsg('');
    try {
      const r = await api.portalUpdatePhone(profile.employee_id, phone);
      setPhone(r.phone);
      setPhoneMsg('Saved.');
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const sendEmailCode = async () => {
    setBusy(true); setError('');
    try { await api.portalRequestEmailChange(newEmail.trim()); setEmailStep('code'); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const confirmEmail = async () => {
    setBusy(true); setError('');
    try {
      await api.portalConfirmEmailChange(emailCode.trim());
      setEmailStep('idle'); setNewEmail(''); setEmailCode('');
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>My Contact Info</h2>
      {error && <p className="error-banner">{error}</p>}
      <div className="field">
        <label htmlFor={`phone-${profile.employee_id}`}>Phone number</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id={`phone-${profile.employee_id}`} value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneMsg(''); }} placeholder="(555) 123-4567" style={{ flex: '1 1 180px' }} />
          <button type="button" className="secondary" disabled={busy || phone === profile.phone} onClick={savePhone}>Save Phone</button>
        </div>
        {phoneMsg && <span style={{ fontSize: 12, color: 'var(--status-current-text)' }}>{phoneMsg}</span>}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Email address</label>
        {emailStep === 'idle' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>{accountEmail}</span>
            <button type="button" className="secondary" onClick={() => setEmailStep('editing')}>Change Email</button>
          </div>
        )}
        {emailStep === 'editing' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email address" style={{ flex: '1 1 200px' }} autoFocus />
            <button type="button" className="secondary" disabled={busy || !newEmail.trim()} onClick={sendEmailCode}>Send Code</button>
            <button type="button" className="link-button" onClick={() => { setEmailStep('idle'); setNewEmail(''); }}>Cancel</button>
          </div>
        )}
        {emailStep === 'code' && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span className="page-subtitle" style={{ margin: 0, fontSize: 13 }}>Enter the code we sent to <strong>{newEmail.trim()}</strong>. You&apos;ll sign in with the new address from now on.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input inputMode="numeric" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="6-digit code" style={{ flex: '1 1 140px' }} autoFocus />
              <button type="button" disabled={busy || emailCode.replace(/\D/g, '').length !== 6} onClick={confirmEmail}>Confirm</button>
              <button type="button" className="link-button" onClick={() => { setEmailStep('idle'); setEmailCode(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Profile({ profile, accountEmail, onChanged }) {
  const t = profile.trainer;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--esr-gold-ink)' }}>
          {[profile.company, profile.is_trainer ? 'ESR Trainer' : null].filter(Boolean).join(' · ')}
        </div>
        <h1 style={{ margin: '4px 0 0' }}>Hi, {profile.first_name}</h1>
        {profile.job_title && <p className="page-subtitle" style={{ margin: '4px 0 0' }}>{profile.job_title}</p>}
      </div>

      {t && (
        <div className="card">
          <h2>Upcoming Trainings to Teach ({t.upcoming.length})</h2>
          {t.upcoming.length === 0 ? <p className="empty-state" style={{ padding: 8, textAlign: 'left' }}>Nothing scheduled right now.</p> : (
            <div className="table-scroll" style={{ maxHeight: 'none' }}>
              <table>
                <thead><tr><th>Date</th><th>Training</th><th>Client</th><th>Location</th><th>Signed in</th></tr></thead>
                <tbody>
                  {t.upcoming.map((s) => (
                    <tr key={s.session_id}><td>{sessionDates(s)}</td><td>{s.training}</td><td>{s.client}</td><td style={{ whiteSpace: 'normal' }}>{s.location || '—'}</td><td>{s.attendees}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {t && (
        <div className="stat-grid" style={{ marginBottom: 0 }}>
          <div className="stat-tile">
            <div className="stat-label">Trainer Rating</div>
            <div className="value">{t.ratings.trainer_avg != null ? `★ ${t.ratings.trainer_avg.toFixed(1)}` : '—'}</div>
            <div className="label">out of 5</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Training Effectiveness</div>
            <div className="value">{t.ratings.effectiveness_avg != null ? t.ratings.effectiveness_avg.toFixed(1) : '—'}</div>
            <div className="label">out of 5</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Feedback Responses</div>
            <div className="value">{t.ratings.responses}</div>
            <div className="label">from sessions you taught</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Sessions Taught</div>
            <div className="value">{t.taught.length}</div>
            <div className="label">closed out</div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>My Trainings ({profile.trainings.length})</h2>
        {profile.trainings.length === 0 ? <p className="empty-state" style={{ padding: 8, textAlign: 'left' }}>No trainings on file yet.</p> : (
          <div className="table-scroll" style={{ maxHeight: 'none' }}>
            <table>
              <thead><tr><th>Training</th><th>Completed</th><th>Expires</th><th>Status</th><th>Certificate</th></tr></thead>
              <tbody>
                {profile.trainings.map((tr) => (
                  <tr key={tr.record_id}>
                    <td style={{ whiteSpace: 'normal' }}>{tr.training_name}</td>
                    <td>{longDate(tr.completion_date)}</td>
                    <td>{tr.expiration_date ? longDate(tr.expiration_date) : 'No expiration'}</td>
                    <td><StatusBadge status={tr.status} /></td>
                    <td>{tr.has_certificate ? <a href={`/api/portal/records/${tr.record_id}/certificate`}>Download</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {t && t.taught.length > 0 && (
        <div className="card">
          <h2>Sessions I&apos;ve Taught ({t.taught.length})</h2>
          <div className="table-scroll" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>Date</th><th>Training</th><th>Client</th><th>Attendees</th></tr></thead>
              <tbody>
                {t.taught.map((s) => (
                  <tr key={s.session_id}><td>{sessionDates(s)}</td><td>{s.training}</td><td>{s.client}</td><td>{s.attendees}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>My Documents ({profile.documents.length})</h2>
        {profile.documents.length === 0 ? <p className="empty-state" style={{ padding: 8, textAlign: 'left' }}>No documents on file.</p> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {profile.documents.map((d) => (
              <div key={d.document_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <a href={`/api/portal/documents/${d.document_id}`}>{d.label}</a>
                  {d.training_name && <span className="page-subtitle" style={{ margin: 0, fontSize: 12 }}> · {d.training_name}</span>}
                </span>
                <span className="page-subtitle" style={{ margin: 0, fontSize: 12, whiteSpace: 'nowrap' }}>{d.uploaded_at?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ContactCard key={profile.employee_id + accountEmail} profile={profile} accountEmail={accountEmail} onChanged={onChanged} />
    </div>
  );
}

export default function Portal() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | signed-out | ready
  const [active, setActive] = useState(0);

  const load = () => api.portalMe()
    .then((d) => { setData(d); setStatus('ready'); })
    .catch(() => { setData(null); setStatus('signed-out'); });
  useEffect(() => { load(); }, []);

  const logout = async () => {
    try { await api.portalLogout(); } catch { /* signed out either way */ }
    setData(null); setStatus('signed-out');
  };

  if (status === 'loading') return <Shell><p className="page-subtitle">Loading…</p></Shell>;
  if (status === 'signed-out') return <Shell><SignIn onSignedIn={load} /></Shell>;

  const profile = data.profiles[Math.min(active, data.profiles.length - 1)];
  return (
    <Shell onLogout={logout}>
      {data.profiles.length > 1 && (
        <div className="tab-row" role="tablist" aria-label="Your profiles">
          {data.profiles.map((p, i) => (
            <button key={p.employee_id} type="button" role="tab" aria-selected={i === active} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
              {p.company}{p.is_trainer ? ' (Trainer)' : ''}
            </button>
          ))}
        </div>
      )}
      <Profile profile={profile} accountEmail={data.email} onChanged={load} />
    </Shell>
  );
}
