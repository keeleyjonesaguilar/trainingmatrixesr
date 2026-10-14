import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api';
import { formatEasternDateTime } from '../lib/dates';

// Emailing a closed session's certificates by hand (Keeley's request, 2026-10-14) - nothing goes
// out until Send is pressed. server/lib/certificateEmails.js does the sending.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const muted = { fontSize: 12, color: 'var(--color-text-muted)' };

function Result({ result, onClose }) {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        {result.sent.length
          ? <>Emailed <strong>{result.sent.length}</strong> {result.sent.length === 1 ? 'person' : 'people'} their certificate.</>
          : 'Nothing was sent.'}
      </p>
      {result.failed.length > 0 && (
        <div className="error-banner">
          Didn&apos;t go through - try again in a minute: {result.failed.map((f) => `${f.name} (${f.email})`).join(', ')}
        </div>
      )}
      {result.skipped.length > 0 && (
        <p style={muted}>Skipped: {result.skipped.map((s) => `${s.name} - ${s.reason}`).join('; ')}</p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

// Each attendee gets only their own certificate(s). The address is prefilled from what they signed
// in with, or their employee profile; one typed here is saved for next time.
export function EmailEmployeesModal({ sessionId, onClose, onSent }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.getCertificateEmailOptions(sessionId)
      .then((data) => setRows(data.attendees.map((a) => ({
        ...a,
        // Ticked to start with: has a certificate and an address, and hasn't been sent it yet.
        checked: a.certificates.length > 0 && EMAIL_PATTERN.test(a.email) && !a.certificate_emailed_at,
      }))))
      .catch((e) => setError(e.message));
  }, [sessionId]);

  const update = (id, changes) => setRows((rs) => rs.map((r) => (r.attendee_id === id ? { ...r, ...changes } : r)));
  const sendable = (r) => r.certificates.length > 0 && EMAIL_PATTERN.test(r.email.trim());
  const chosen = (rows || []).filter((r) => r.checked && sendable(r));
  const allSendable = (rows || []).filter(sendable);

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api.emailCertificatesToAttendees(sessionId, chosen.map((r) => ({ attendee_id: r.attendee_id, email: r.email.trim() })));
      setResult(res);
      onSent?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={sending ? undefined : onClose} maxWidth={760}>
      <h3 style={{ marginTop: 0 }}>Email Certificates to Employees</h3>
      {error && <div className="error-banner">{error}</div>}
      {result ? <Result result={result} onClose={onClose} /> : !rows ? (
        <p>Loading…</p>
      ) : (
        <>
          <p style={{ ...muted, marginTop: 0 }}>
            Each person gets one email with only their own certificate. Type in a missing email and it&apos;s saved to their profile.
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13 }}>
            <button type="button" className="link-button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, checked: sendable(r) })))}>
              Select all with an email
            </button>
            <button type="button" className="link-button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, checked: false })))}>
              Clear
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th></th><th>Name</th><th>Certificate</th><th>Email</th><th>Last Sent</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const noCert = r.certificates.length === 0;
                  const badEmail = r.email.trim() && !EMAIL_PATTERN.test(r.email.trim());
                  return (
                    <tr key={r.attendee_id} style={noCert ? { opacity: 0.55 } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Email ${r.trainee_name}`}
                          checked={r.checked && sendable(r)}
                          disabled={noCert || !sendable(r)}
                          onChange={(e) => update(r.attendee_id, { checked: e.target.checked })}
                        />
                      </td>
                      <td>{r.trainee_name}</td>
                      <td style={{ fontSize: 13 }}>
                        {!noCert ? r.certificates.join(', ') : r.certificate_file_missing ? 'File not found on this server' : 'No certificate'}
                      </td>
                      <td>
                        <input
                          type="email"
                          value={r.email}
                          placeholder="Add email"
                          disabled={noCert}
                          style={{ width: 210, ...(badEmail ? { borderColor: 'var(--status-expired-text, #b3261e)' } : {}) }}
                          onChange={(e) => update(r.attendee_id, { email: e.target.value, checked: EMAIL_PATTERN.test(e.target.value.trim()) })}
                        />
                      </td>
                      <td style={muted}>
                        {r.certificate_emailed_at
                          ? <>{formatEasternDateTime(r.certificate_emailed_at)}<br />{r.certificate_emailed_to}</>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={5} className="empty-state">No attendees on this session.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <span style={muted}>
              {chosen.length} of {allSendable.length} with an email selected
              {sending && chosen.length > 10 ? ' - a big class takes a minute, keep this open' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={sending} onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-sm" disabled={sending || !chosen.length} onClick={send}>
                {sending ? 'Sending…' : `Email ${chosen.length} ${chosen.length === 1 ? 'Person' : 'People'}`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// The company gets the certificate ZIP(s) - same files as the Download Certificates buttons - and
// the sign-in roster if ticked, in one email. Sending ticks "Sent to Client".
export function EmailCompanyModal({ session, onClose, onSent }) {
  const [info, setInfo] = useState(null);
  const [emails, setEmails] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [includeRoster, setIncludeRoster] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);

  useEffect(() => {
    api.getCertificateEmailOptions(session.session_id)
      .then((data) => {
        setInfo(data);
        setEmails(data.client_certificate_emails || '');
        setSaveAsDefault(!data.client_certificate_emails);
      })
      .catch((e) => setError(e.message));
  }, [session.session_id]);

  const changedFromSaved = info && emails.trim() !== (info.client_certificate_emails || '');
  const certifiedCount = info ? info.attendees.filter((a) => a.certificates.length).length : 0;
  const filesMissing = info ? info.attendees.filter((a) => a.certificate_file_missing).length : 0;
  const trainings = [session.training_type_label, ...(session.additional_trainings || []).map((t) => t.training_type_label)];

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const res = await api.emailCertificatesToCompany(session.session_id, {
        emails, include_roster: includeRoster, save_as_default: saveAsDefault && changedFromSaved,
      });
      setSentTo(res.sent_to);
      onSent?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={sending ? undefined : onClose} maxWidth={560}>
      <h3 style={{ marginTop: 0 }}>Email Certificates to {session.client_name}</h3>
      {error && <div className="error-banner">{error}</div>}
      {sentTo ? (
        <>
          <p style={{ marginTop: 0 }}>Certificates emailed to <strong>{sentTo.join(', ')}</strong>. &quot;Sent to Client&quot; is now ticked.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={onClose}>Done</button>
          </div>
        </>
      ) : !info ? (
        <p>Loading…</p>
      ) : (
        <>
          {info.certificates_emailed_to_client_at && (
            <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
              Already sent {formatEasternDateTime(info.certificates_emailed_to_client_at)} to {info.certificates_emailed_to_client}.
            </div>
          )}
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }} htmlFor="company-cert-emails">Send to</label>
          <input
            id="company-cert-emails"
            type="text"
            style={{ width: '100%' }}
            placeholder="safety@company.com, hr@company.com"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
          <div style={{ ...muted, marginTop: 4 }}>Separate more than one address with a comma.</div>
          {changedFromSaved && emails.trim() && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={saveAsDefault} onChange={(e) => setSaveAsDefault(e.target.checked)} />
              Save as {session.client_name}&apos;s certificate email for next time
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={includeRoster} onChange={(e) => setIncludeRoster(e.target.checked)} />
            Include the sign-in roster (PDF){session.master_training_id === 'TRN-020' ? ' and AHA course roster' : ''}
          </label>
          <div style={{ marginTop: 14, fontSize: 13 }}>
            <strong>Attached:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {trainings.map((t) => <li key={t}>Certificates ZIP – {t}</li>)}
              {includeRoster && <li>Sign-in roster</li>}
            </ul>
            <div style={{ ...muted, marginTop: 6 }}>
              {certifiedCount} employee{certifiedCount === 1 ? '' : 's'} with a certificate. Replies come back to you.
            </div>
            {filesMissing > 0 && (
              <div className="error-banner" style={{ marginTop: 8 }}>
                {filesMissing} certificate file{filesMissing === 1 ? ' isn’t' : 's aren’t'} on this server - on a local copy the files are on the live site, so they can only be sent from there.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={sending} onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-sm" disabled={sending || !emails.trim() || !certifiedCount} onClick={send}>
              {sending ? 'Sending…' : info.certificates_emailed_to_client_at ? 'Send Again' : 'Send to Company'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
