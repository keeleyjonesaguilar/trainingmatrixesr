// Public interest sign-up on the session page (Keeley's request, 2026-10-23) - opens a class's
// sign-up page at /register/<token> (pages/PublicSignup.jsx), sets the page text, and lists who's
// interested. Server side: server/routes/publicSignupAdmin.js.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatEasternDateTime } from '../lib/dates';
import { downloadCsv } from '../lib/csv';

const fullName = (first, last) => `${first || ''} ${last || ''}`.trim();

function formFrom(data) {
  return {
    open: data.open || !data.url, // a class being set up for the first time is opened on save
    link_name: data.link_name,
    class_hours: data.class_hours,
    details: data.details,
  };
}

// Shown once the class has a public sign-up, or when the office clicks "Set up public sign-up" at
// the top of the session page (SessionDetail.jsx) - then it opens straight into the settings, and
// onSetUp/onCancelSetUp tell the page whether to keep it.
export default function PublicSignupPanel({ sessionId, sessionLabel, onSetUp, onCancelSetUp }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.getPublicSignup(sessionId).then((d) => {
    setData(d);
    // Not set up yet - this panel is only showing because "Set up public sign-up" was clicked.
    if (!d.url) { setForm(formFrom(d)); setEditing(true); }
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return error ? <p className="error-banner">{error}</p> : null;

  const startEditing = () => { setForm(formFrom(data)); setEditing(true); setError(''); };
  const cancel = () => {
    setEditing(false);
    setError('');
    if (!data.url) onCancelSetUp?.();
  };
  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const firstSetUp = !data.url;
      setData(await api.savePublicSignup(sessionId, form));
      setEditing(false);
      if (firstSetUp) onSetUp?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const remove = async (reg) => {
    const who = fullName(reg.contact_first_name, reg.contact_last_name);
    if (!window.confirm(`Delete ${who}'s sign-up (${reg.seats} ${reg.seats === 1 ? 'person' : 'people'})? This can't be undone.`)) return;
    setBusyId(reg.registration_id);
    try {
      await api.deletePublicRegistration(sessionId, reg.registration_id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const exportCsv = () => {
    // One row per person - names are optional, so anyone without one still gets a row.
    const people = (r) => [
      ...r.attendees.map((a) => ({ name: fullName(a.first_name, a.last_name), signedIn: a.signed_in ? 'Yes' : 'No' })),
      ...Array.from({ length: Math.max(0, r.seats - r.attendees.length) }, () => ({ name: '(no name given)', signedIn: '' })),
    ];
    const rows = data.registrations.flatMap((r) => people(r).map((p) => ({
      Person: p.name,
      'Signed In': p.signedIn,
      'Signed Up By': fullName(r.contact_first_name, r.contact_last_name),
      Email: r.contact_email,
      Phone: r.contact_phone,
      Company: r.company || '',
      'Signed Up': formatEasternDateTime(r.created_at),
    })));
    downloadCsv(`${sessionLabel || 'Class'} - Interest List.csv`, rows);
  };

  const regs = data.registrations;

  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--esr-gold)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>
          Public Sign-Up{' '}
          {data.url && (
            <span className={`badge ${data.open ? 'badge-open' : 'badge-closed'}`} style={{ marginLeft: 6 }}>
              {data.open ? 'Taking sign-ups' : 'Sign-up closed'}
            </span>
          )}
        </h3>
        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}>{copied ? 'Copied!' : 'Copy Sign-Up Link'}</button>
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Open Page ↗</a>
            <button type="button" className="btn btn-secondary btn-sm" onClick={startEditing}>Settings</button>
          </div>
        )}
      </div>

      {error && <p className="error-banner" style={{ marginTop: 12 }}>{error}</p>}

      {editing ? (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label>Link name</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>…/register/</span>
              <input
                value={form.link_name}
                onChange={(e) => setForm((f) => ({ ...f, link_name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder="osha30"
                style={{ maxWidth: 240 }}
              />
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Letters, numbers and dashes, like osha30 or osha30-nov. Each class needs its own.
              {data.url && form.link_name !== data.link_name ? ' Changing it stops the old link from working.' : ''}
            </span>
          </div>
          <div className="field">
            <label>Class hours</label>
            <input value={form.class_hours} onChange={setField('class_hours')} placeholder="7:30 AM – 4:30 PM" style={{ maxWidth: 320 }} />
          </div>
          <div className="field">
            <label>Notes shown on the sign-up page</label>
            <textarea rows={3} value={form.details} onChange={setField('details')} placeholder="OSHA cards will be provided upon completion." />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.open} onChange={setField('open')} />
            Taking sign-ups (untick to close sign-up; the link then says sign-up is closed)
          </label>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            The page also shows this class&apos;s training, dates and location from the session details above. Sign-up closes on its own after the first class day.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, margin: '12px 0', color: 'var(--color-text-muted)' }}>
            <span><strong style={{ color: 'var(--color-text)' }}>{data.people}</strong> {data.people === 1 ? 'person' : 'people'} interested</span>
            <span style={{ wordBreak: 'break-all' }}>{data.url}</span>
          </div>

          {regs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>No one has signed up yet.</p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Signed up by</th>
                      <th>Company</th>
                      <th>People</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {regs.map((r) => (
                      <tr key={r.registration_id}>
                        <td>
                          <strong>{fullName(r.contact_first_name, r.contact_last_name)}</strong>
                          <div style={{ color: 'var(--color-text-muted)' }}>{r.contact_email}</div>
                          <div style={{ color: 'var(--color-text-muted)' }}>{r.contact_phone}</div>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{formatEasternDateTime(r.created_at)}</div>
                        </td>
                        <td>{r.company || '—'}</td>
                        <td>
                          {r.attendees.map((a) => (
                            <div key={a.id}>
                              {fullName(a.first_name, a.last_name)}
                              {a.signed_in && <span className="badge badge-current" style={{ marginLeft: 6, fontSize: 11 }}>Signed in</span>}
                            </div>
                          ))}
                          {r.seats > r.attendees.length && (
                            <div style={{ color: 'var(--color-text-muted)' }}>
                              {r.attendees.length ? '+ ' : ''}{r.seats - r.attendees.length} {r.attendees.length ? 'more' : (r.seats === 1 ? 'person' : 'people')} (no name given)
                            </div>
                          )}
                        </td>
                        <td>
                          <button type="button" className="link-button" style={{ color: 'var(--status-expired-text)' }} disabled={busyId === r.registration_id} onClick={() => remove(r)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={exportCsv}>Download Interest List (CSV)</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
