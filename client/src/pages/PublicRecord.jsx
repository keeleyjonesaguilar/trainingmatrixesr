// The page an employee's QR code opens (Keeley's request, 2026-09-30) - /r/:token, no login,
// read-only: their name, company, and each training's latest completion and status, for whoever
// scans a badge or hard-hat sticker on site. Served by server/routes/publicRecord.js. Each training
// links to its ESR certificate and any card filed under it (Keeley's request, 2026-10-05).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import StatusBadge from '../components/StatusBadge.jsx';
import { easternToday, formatShortDate } from '../lib/dates';

function DocLinks({ links }) {
  if (!links.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4, fontSize: 13 }}>
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}

function longDate(d) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!match) return d || '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PublicRecord() {
  const { token } = useParams();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.publicRecord(token).then(setRecord).catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="public-shell">
        <div className="public-card card"><p className="error-banner" style={{ margin: 0 }}>{error}</p></div>
      </div>
    );
  }
  if (!record) return <div className="public-shell"><div className="public-card">Loading…</div></div>;

  const today = easternToday();
  const expired = record.trainings.filter((t) => t.status === 'Expired').length;

  return (
    <div className="public-shell">
      <div className="public-card" style={{ maxWidth: 560 }}>
        <div className="public-header">
          {record.company_logo_url
            ? <img src={record.company_logo_url} alt={record.company} style={{ maxHeight: 56, maxWidth: 200, objectFit: 'contain', margin: '0 auto 10px', display: 'block' }} />
            : <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />}
          <h2 style={{ margin: '0 0 2px' }}>{record.name}</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {[record.job_title, record.company].filter(Boolean).join(' · ')}
            {record.is_trainer && <span className="badge badge-current" style={{ marginLeft: 8, fontSize: 11 }}>ESR Trainer</span>}
          </div>
          {!record.active && <p className="error-banner" style={{ marginTop: 10 }}>This person is no longer listed as active.</p>}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Training Record</h3>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>As of {formatShortDate(today)}</span>
          </div>
          {expired > 0 && (
            <p className="error-banner" style={{ margin: '6px 0 10px' }}>{expired} training{expired === 1 ? ' is' : 's are'} expired.</p>
          )}
          {record.trainings.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No trainings on file yet.</p>
          ) : (
            record.trainings.map((t) => (
              <div key={t.training_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.training_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Completed {longDate(t.completion_date)}
                    {t.expiration_date ? ` · Expires ${longDate(t.expiration_date)}` : ' · No expiration'}
                  </div>
                  <DocLinks links={[
                    ...(t.certificate_url ? [{ label: 'ESR Certificate', url: t.certificate_url }] : []),
                    ...(t.documents || []),
                  ]} />
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))
          )}
        </div>
        {record.other_documents?.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Cards &amp; Documents</h3>
            {record.other_documents.map((d) => (
              <div key={d.url} style={{ padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{d.training_name}</div>
                <DocLinks links={[d]} />
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 12 }}>
          Evolution Safety Resources · Safety Training Matrix
        </p>
      </div>
    </div>
  );
}
