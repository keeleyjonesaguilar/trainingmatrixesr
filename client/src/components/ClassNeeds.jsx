import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatEasternDateTime } from '../lib/dates';

// Class Needs (Keeley, 2026-11-16) - what this class needs: students, room layout, site contact, AV
// hookup, who at the company gets the roster, anything else. Every box is optional.
// A new training emails a class details request to whoever is on for it on Manage Users (Guy and
// Jayna); their link (?needs=1) opens this card ready to fill in, and saving marks the request done
// and bells the office. No review step. The roster email(s) prefill "Email Certificates to Company";
// trainers see whatever is filled in as a "Class needs" section of their class summary.
const AV_LABELS = { yes: 'Needed', no: 'Not needed' };
const labelStyle = { display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 };
const hintStyle = { margin: '4px 0 0', fontSize: 12 };

function openedFromRequest() {
  return new URLSearchParams(window.location.search).get('needs') === '1';
}

export default function ClassNeeds({ session, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef(null);

  const clientDefault = session.client_certificate_emails || '';
  const startEdit = () => {
    setForm({
      needs_student_count: session.needs_student_count ?? '',
      needs_room_layout: session.needs_room_layout || '',
      needs_site_contact_name: session.needs_site_contact_name || '',
      needs_site_contact_phone: session.needs_site_contact_phone || '',
      needs_av_hookup: session.needs_av_hookup || '',
      roster_emails: session.roster_emails || clientDefault,
      needs_notes: session.needs_notes || '',
    });
    setError('');
    setEditing(true);
  };

  // The request email's link opens the form straight away and scrolls to it.
  useEffect(() => {
    if (!openedFromRequest() || session.session_kind === 'toolbox_talk') return;
    startEdit();
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [session.session_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session.session_kind === 'toolbox_talk') return null;
  const hasAny = [
    session.needs_student_count, session.needs_room_layout, session.needs_site_contact_name, session.needs_site_contact_phone,
    session.needs_av_hookup, session.roster_emails, session.needs_notes,
  ].some((v) => v !== null && v !== undefined && v !== '');
  const waiting = Boolean(session.needs_requested_at && !session.needs_completed_at);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateSessionNeeds(session.session_id, form);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendRequest = async () => {
    const again = session.needs_requested_at ? '\n\nA request already went out - this sends it again and marks it as waiting until someone saves the details.' : '';
    if (!window.confirm(`Email the class details request (a link to this card) to everyone turned on for "Class Details Requests" on Manage Users?${again}`)) return;
    setRequesting(true);
    setError('');
    try {
      const updated = await api.requestClassNeeds(session.session_id);
      onSaved(updated);
      window.alert(`Request emailed to ${updated.sent_to.join(', ')}.${updated.failed?.length ? `\n\nCould not send to ${updated.failed.join(', ')}.` : ''}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setRequesting(false);
    }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const row = (label, value) => (
    <div className="class-needs-row">
      <div className="class-needs-label">{label}</div>
      <div className="class-needs-value">{value}</div>
    </div>
  );
  const blank = <span style={{ color: 'var(--color-text-muted)' }}>–</span>;
  const contact = [session.needs_site_contact_name, session.needs_site_contact_phone].filter(Boolean).join(' · ');

  return (
    <div ref={cardRef} className="card" style={{ marginBottom: 20, ...(waiting ? { borderLeft: '4px solid var(--esr-gold)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Class Needs</h3>
        {!editing && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`btn btn-sm ${waiting ? 'btn-accent' : 'btn-secondary'}`} onClick={startEdit}>
              {waiting ? 'Fill in class details' : hasAny ? 'Edit' : 'Add class details'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={requesting} onClick={sendRequest}>
              {requesting ? 'Sending…' : session.needs_requested_at ? 'Send request again' : 'Send request'}
            </button>
          </div>
        )}
      </div>

      {/* Where the class details request stands. */}
      {session.needs_requested_at && (
        <div className="class-needs-status" style={{ margin: '8px 0 4px' }}>
          {session.needs_completed_at ? (
            <span className="badge badge-current">Filled in by {session.needs_completed_by} · {formatEasternDateTime(session.needs_completed_at)}</span>
          ) : (
            <span className="badge badge-expiringsoon">Waiting on {session.needs_requested_to} · requested {formatEasternDateTime(session.needs_requested_at)}</span>
          )}
        </div>
      )}
      <p className="page-subtitle" style={{ margin: '4px 0 10px' }}>
        All optional. The trainer(s) see whatever is filled in here in their class summary email and Training Portal.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {!editing ? (
        <>
          {row('Students', session.needs_student_count ?? blank)}
          {row('Room layout', session.needs_room_layout || blank)}
          {row('Site contact', contact || blank)}
          {row('AV hookup', session.needs_av_hookup ? AV_LABELS[session.needs_av_hookup] : blank)}
          {row('Roster goes to', session.roster_emails || (clientDefault
            ? <span>{clientDefault} <span style={{ color: 'var(--color-text-muted)' }}>({session.client_name}&apos;s saved certificate email)</span></span>
            : blank))}
          {row('Other needs', session.needs_notes ? <span style={{ whiteSpace: 'pre-line' }}>{session.needs_notes}</span> : blank)}
          {session.needs_updated_at && (
            <div className="page-subtitle" style={{ margin: '8px 0 0', fontSize: 12 }}>
              Last updated {formatEasternDateTime(session.needs_updated_at)}{session.needs_updated_by ? ` by ${session.needs_updated_by}` : ''}
            </div>
          )}
        </>
      ) : (
        <div className="class-needs-form">
          <div className="class-needs-grid">
            <div>
              <label htmlFor="needs-students" style={labelStyle}>Number of students</label>
              <input id="needs-students" type="number" min="0" step="1" inputMode="numeric" value={form.needs_student_count} onChange={set('needs_student_count')} />
            </div>
            <div>
              <label htmlFor="needs-room" style={labelStyle}>Room layout</label>
              <input id="needs-room" type="text" placeholder="e.g., classroom, conference table, outdoors" value={form.needs_room_layout} onChange={set('needs_room_layout')} />
            </div>
            <div>
              <label htmlFor="needs-contact-name" style={labelStyle}>Site contact name</label>
              <input id="needs-contact-name" type="text" value={form.needs_site_contact_name} onChange={set('needs_site_contact_name')} />
            </div>
            <div>
              <label htmlFor="needs-contact-phone" style={labelStyle}>Site contact phone</label>
              <input id="needs-contact-phone" type="tel" value={form.needs_site_contact_phone} onChange={set('needs_site_contact_phone')} />
            </div>
            <div>
              <label htmlFor="needs-av" style={labelStyle}>AV hookup</label>
              <select id="needs-av" value={form.needs_av_hookup} onChange={set('needs_av_hookup')}>
                <option value="">Not asked yet</option>
                <option value="yes">Needed</option>
                <option value="no">Not needed</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="needs-roster" style={labelStyle}>Company contact email for the roster</label>
            <input id="needs-roster" type="text" style={{ width: '100%' }} placeholder="safety@company.com, hr@company.com" value={form.roster_emails} onChange={set('roster_emails')} />
            <div className="page-subtitle" style={hintStyle}>Separate more than one with a comma. Fills in &quot;Email Certificates to Company&quot; for this class.</div>
          </div>
          <div>
            <label htmlFor="needs-notes" style={labelStyle}>Other needs</label>
            <textarea id="needs-notes" rows={3} style={{ width: '100%' }} placeholder="e.g., extension cord, site badge for the trainer" value={form.needs_notes} onChange={set('needs_notes')} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-accent btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save class details'}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
