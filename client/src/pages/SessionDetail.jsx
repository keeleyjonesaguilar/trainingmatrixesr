import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

function RecordStatusBadge({ status }) {
  const labels = {
    linked: 'Added to employee file',
    no_catalog_match: 'Employee on file (no catalog match)',
    failed: 'Needs attention',
    pending: 'Processing…',
  };
  const classes = {
    linked: 'badge-current',
    no_catalog_match: 'badge-pendingreview',
    failed: 'badge-expired',
    pending: 'badge-pendingreview',
  };
  return <span className={`badge ${classes[status] || 'badge-notapplicable'}`}>{labels[status] || status}</span>;
}

export default function SessionDetail() {
  const { id } = useParams();
  const isAdmin = useIsAdmin();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [retryingId, setRetryingId] = useState(null);

  const load = () => {
    api.getTrainingSession(id).then(setSession).catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000); // live-ish roster while a session is open
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveEdit = async (attendeeId) => {
    await api.updateSessionAttendee(id, attendeeId, { trainee_name: editName, trainee_phone: editPhone });
    setEditingId(null);
    load();
  };

  const removeAttendee = async (attendeeId) => {
    if (!window.confirm('Remove this sign-in entry?')) return;
    await api.deleteSessionAttendee(id, attendeeId);
    load();
  };

  const retryProcessing = async (attendeeId) => {
    setRetryingId(attendeeId);
    try {
      await api.retryAttendeeProcessing(id, attendeeId);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetryingId(null);
    }
  };

  if (error) return <p className="error-banner">{error}</p>;
  if (!session) return <p>Loading…</p>;

  return (
    <div>
      <Link to="/sessions" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        ← All sessions
      </Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>
        {session.training_type_label}
      </h1>
      <p className="page-subtitle">
        {session.client_name} · {session.session_date} · Trainer: {session.trainer_signed_name || session.trainer_name}{' '}
        · <span className={`badge badge-${session.status}`}>{session.status === 'open' ? 'Open' : 'Closed'}</span>
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Sign-In QR Code</h3>
          <img
            src={`/api/training-sessions/${id}/qrcode.png`}
            alt="Session QR code"
            style={{ width: '100%', borderRadius: 8 }}
          />
          <a
            href={`/api/training-sessions/${id}/qrcode.png`}
            download
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
          >
            Download QR (PNG)
          </a>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10, wordBreak: 'break-all' }}>
            {session.public_url}
          </p>

          {session.status === 'closed' && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a href={`/api/training-sessions/${id}/roster.pdf`} className="btn btn-sm" style={{ justifyContent: 'center' }}>
                Download Roster (PDF)
              </a>
              <a
                href={`/api/training-sessions/${id}/roster.csv`}
                className="btn btn-secondary btn-sm"
                style={{ justifyContent: 'center' }}
              >
                Export Roster (CSV)
              </a>
            </div>
          )}
        </div>

        <div className="card">
          {session.outline && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Outline</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>{session.outline}</p>
            </div>
          )}
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Roster ({session.attendees.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Signed At</th>
                {session.status === 'closed' && <th>Certificate</th>}
                {session.status === 'closed' && <th>Employee File</th>}
                {session.status === 'open' && isAdmin && <th></th>}
                {session.status === 'closed' && isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {session.attendees.map((a) => (
                <tr key={a.attendee_id}>
                  {editingId === a.attendee_id ? (
                    <>
                      <td>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td>
                        <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                      </td>
                      <td colSpan={2}>
                        <button className="btn btn-sm" onClick={() => saveEdit(a.attendee_id)}>
                          Save
                        </button>{' '}
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{a.trainee_name}</td>
                      <td>{a.trainee_phone || '—'}</td>
                      <td>{new Date(a.signed_at).toLocaleString()}</td>
                      {session.status === 'closed' && (
                        <td>
                          {a.certificate_path ? (
                            <a href={`/api/training-sessions/${id}/attendees/${a.attendee_id}/certificate.pdf`}>Download</a>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      {session.status === 'closed' && (
                        <td>
                          <RecordStatusBadge status={a.processing_status} />
                        </td>
                      )}
                      {session.status === 'open' && isAdmin && (
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingId(a.attendee_id);
                              setEditName(a.trainee_name);
                              setEditPhone(a.trainee_phone || '');
                            }}
                          >
                            Edit
                          </button>{' '}
                          <button className="btn btn-danger btn-sm" onClick={() => removeAttendee(a.attendee_id)}>
                            Remove
                          </button>
                        </td>
                      )}
                      {session.status === 'closed' && isAdmin && (
                        <td>
                          {(a.processing_status === 'failed' || a.processing_status === 'no_catalog_match') && (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={retryingId === a.attendee_id}
                              onClick={() => retryProcessing(a.attendee_id)}
                            >
                              {retryingId === a.attendee_id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {session.attendees.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No sign-ins yet — display the QR code for trainees to scan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
