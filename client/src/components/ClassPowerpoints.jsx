import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// A class's PowerPoints on the session page (2026-11-06) - the same downloads its trainers get in
// the class summary email and Training Portal, with the class's Sign-In / Feedback QR slides in
// them. A training with no PowerPoint yet shows here so it's caught before class day.
export default function ClassPowerpoints({ session }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSessionPowerpoints(session.session_id).then(setPlan).catch((e) => setError(e.message));
    // Re-check whenever the session's trainings or days change.
  }, [session.session_id, session.master_training_id, session.total_days, session.multi_training_day, session.additional_trainings?.length]);

  if (session.session_kind === 'toolbox_talk') return null;
  const legacyDayLinks = (session.day_wetransfer_links || []).filter(Boolean);
  const hasLegacy = Boolean(session.wetransfer_link || legacyDayLinks.length);
  const groups = plan ? plan.groups : [];
  const missingAny = groups.some((g) => g.items.some((it) => !it.available));

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>PowerPoints</h3>
      <p className="page-subtitle" style={{ margin: '2px 0 10px' }}>
        What the trainer{session.total_days && !session.multi_training_day ? 's get for each day' : ' gets'} in the class summary email and Training Portal.
        {session.total_days && !session.multi_training_day
          ? " Each day starts with this class's Sign-In QR slide and ends with the Feedback QR slide, so attendees rate that day's trainer."
          : " This class's Sign-In QR slide is added at the start and the Feedback QR slide at the end."}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {!plan && !error && <p className="page-subtitle" style={{ margin: 0 }}>Loading…</p>}
      {groups.map((g) => (
        <div key={g.day || 0} className="class-ppt-group">
          {g.day && <div className="class-ppt-group-title">Day {g.day}</div>}
          {g.items.map((it) => (
            <div key={it.key} className="class-ppt-item">
              {it.available ? (
                <a className="btn btn-secondary btn-sm" href={it.path || it.url}>Download: {it.label}</a>
              ) : (
                <span><strong>{it.label}</strong> – <span style={{ color: 'var(--status-expired-text)' }}>{it.missing_reason}</span></span>
              )}
              {it.available && (it.signIn || it.feedback) && (
                <span className="class-ppt-qr">
                  {[it.signIn && 'Sign-In QR slide first', it.feedback && 'Feedback QR slide last'].filter(Boolean).join(' · ')}
                </span>
              )}
              {!it.available && it.fix_path && (
                <Link to={it.fix_path} style={{ fontSize: 12 }}>
                  {it.fix_path.startsWith('/training-types/') ? 'Pick it on the Training Type page' : 'Set it up on the Content page'}
                </Link>
              )}
            </div>
          ))}
        </div>
      ))}
      {plan && !groups.length && <p className="page-subtitle" style={{ margin: 0 }}>No PowerPoints for this class.</p>}
      {hasLegacy && (
        <p className="page-subtitle" style={{ margin: '10px 0 0' }}>
          This class also has an older WeTransfer link{legacyDayLinks.length > 1 ? 's' : ''}
          {missingAny ? ' - it\'s sent where a PowerPoint isn\'t set up yet.' : ' - no longer needed now that the PowerPoints are set up.'}
        </p>
      )}
    </div>
  );
}
