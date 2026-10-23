// Public class interest sign-up (Keeley's request, 2026-10-23) - /register/:token, no login. Anyone
// can leave their details for an open-enrollment class, naming each person who's interested, and
// the office follows up. Served by server/routes/publicSignup.js; the office turns it on per class
// from the session page (components/PublicSignupPanel.jsx).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';

function dayLabel(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!match) return isoDate || '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

const blankPerson = () => ({ first_name: '', last_name: '' });

function Fact({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ width: 82, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

export default function PublicSignup() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [contact, setContact] = useState({ first_name: '', last_name: '', email: '', phone: '', company: '' });
  const [attending, setAttending] = useState(true);
  const [count, setCount] = useState(1);
  const [people, setPeople] = useState([blankPerson()]);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.publicSignupInfo(token).then(setInfo).catch((e) => setLoadError(e.message));
  }, [token]);

  const changeCount = (n) => {
    setCount(n);
    setPeople((list) => Array.from({ length: n }, (_, i) => list[i] || blankPerson()));
  };

  const setContactField = (key) => (e) => setContact((c) => ({ ...c, [key]: e.target.value }));
  const setPersonField = (index, key) => (e) => {
    const { value } = e.target;
    setPeople((list) => list.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };

  // "I'm attending" makes person 1 the one filling in the form.
  const personList = attending
    ? [{ first_name: contact.first_name, last_name: contact.last_name }, ...people.slice(1)]
    : people;

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.publicSignup(token, { ...contact, attendees: personList, website });
      setDone({ names: personList, email: contact.email });
      window.scrollTo(0, 0);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="public-shell">
        <div className="public-card card"><p className="error-banner" style={{ margin: 0 }}>{loadError}</p></div>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="public-shell"><div className="public-card">Loading…</div></div>
    );
  }

  const countOptions = Array.from({ length: info.max_people }, (_, i) => i + 1);
  const mapsUrl = info.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.location)}` : null;

  return (
    <div className="public-shell">
      <div className="public-card" style={{ maxWidth: 560 }}>
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 44, margin: '0 auto 10px', display: 'block' }} />
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--esr-gold)' }}>
            Upcoming Class
          </div>
          <h2 style={{ margin: '4px 0 4px' }}>{info.training}</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            Taught in {info.language === 'spanish' ? 'Spanish' : info.language === 'both' ? 'English & Spanish' : 'English'} by Evolution Safety Resources
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Fact label={info.days.length > 1 ? `${info.days.length} Days` : 'Date'}>
            {info.days.map((d) => <div key={d}>{dayLabel(d)}</div>)}
          </Fact>
          {info.class_hours && <Fact label="Hours">{info.class_hours}{info.days.length > 1 ? ' each day' : ''}</Fact>}
          {info.location && (
            <Fact label="Location">
              {info.location}
              {mapsUrl && <div><a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>Map ↗</a></div>}
            </Fact>
          )}
          {info.details && (
            <p style={{ margin: '10px 0 4px', fontSize: 14, whiteSpace: 'pre-line' }}>{info.details}</p>
          )}
        </div>

        {done ? (
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--status-current-bg)', color: 'var(--status-current-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '4px auto 12px', fontSize: 34, fontWeight: 700 }}>
              ✓
            </div>
            <h2 style={{ margin: '0 0 6px' }}>Thank you!</h2>
            <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 14 }}>
              {done.names.map((p) => `${p.first_name} ${p.last_name}`.trim()).join(', ')}
            </p>
            <p style={{ margin: 0, fontSize: 14 }}>
              We&apos;ve received your information and will be in touch with next steps. A copy is on its way to <strong>{done.email}</strong>.
            </p>
          </div>
        ) : info.closed_reason ? (
          <div className="card"><p className="error-banner" style={{ margin: 0 }}>{info.closed_reason}</p></div>
        ) : (
          <form className="card" onSubmit={submit}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Interested? Leave your information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
              <div className="field">
                <label>First name</label>
                <input value={contact.first_name} onChange={setContactField('first_name')} autoComplete="given-name" required />
              </div>
              <div className="field">
                <label>Last name</label>
                <input value={contact.last_name} onChange={setContactField('last_name')} autoComplete="family-name" required />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={contact.email} onChange={setContactField('email')} autoComplete="email" required />
              </div>
              <div className="field">
                <label>Phone</label>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value.replace(/[^\d\s()+.-]/g, '') }))}
                  placeholder="(919) 555-1234"
                  required
                />
              </div>
            </div>
            <div className="field">
              <label>Company / employer <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span></label>
              <input value={contact.company} onChange={setContactField('company')} autoComplete="organization" />
            </div>
            {/* Hidden from people - only form-filling bots fill this in (server ignores those). */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>

            <div className="field" style={{ marginTop: 6 }}>
              <label>How many people are interested?</label>
              <select value={count} onChange={(e) => changeCount(Number(e.target.value))} style={{ maxWidth: 140 }}>
                {countOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={attending} onChange={(e) => setAttending(e.target.checked)} />
              I&apos;d attend this class myself
            </label>

            {personList.map((p, i) => {
              const isMe = attending && i === 0;
              return (
                <div key={i} style={{ background: 'var(--color-bg)', borderRadius: 8, padding: '10px 12px 2px', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                    Person {i + 1}{isMe ? ' (you)' : ''}
                  </div>
                  {isMe ? (
                    <p style={{ margin: '0 0 10px', fontSize: 14 }}>{`${contact.first_name} ${contact.last_name}`.trim() || 'Your name from above'}</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 12px' }}>
                      <div className="field">
                        <label>First name</label>
                        <input value={p.first_name} onChange={setPersonField(i, 'first_name')} required />
                      </div>
                      <div className="field">
                        <label>Last name</label>
                        <input value={p.last_name} onChange={setPersonField(i, 'last_name')} required />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {formError && <p className="error-banner">{formError}</p>}
            <button type="submit" className="btn" disabled={submitting} style={{ width: '100%', justifyContent: 'center', fontSize: 16, padding: '12px 16px', marginTop: 4 }}>
              {submitting ? 'Sending…' : 'Submit'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
