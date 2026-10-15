import { useState } from 'react';
import { formatShortDate, parseTimestamp, EASTERN_TZ } from '../lib/dates';

// "My Feedback" in the Training Portal (Keeley's request, 2026-10-15: trainers should see their
// responses in "a nice section, not just a long running list"). An overview - average, how the
// ratings spread across 1-5 stars, effectiveness - then one card per class with its own ratings and
// comments, a few at a time. Feedback is anonymous; only what was meant for this trainer is here
// (server/lib/sessionFeedback.js trainerFeedbackByClass).
const CLASSES_STEP = 5;
const COMMENTS_SHOWN = 2;

function shortTraining(label) {
  return String(label || '').replace(/^TRN-\d+\s*-\s*/, '');
}

function Stars({ value, size = 14 }) {
  const whole = Math.round(Number(value) || 0);
  return (
    <span className="fb-stars" style={{ fontSize: size }} aria-label={`${Number(value).toFixed(1)} out of 5`}>
      <span className="fb-stars-on">{'★'.repeat(whole)}</span>
      <span className="fb-stars-off">{'★'.repeat(5 - whole)}</span>
    </span>
  );
}

function classDate(c) {
  if (c.day_dates?.length > 1) return `${formatShortDate(c.day_dates[0])} – ${formatShortDate(c.day_dates[c.day_dates.length - 1])}`;
  return formatShortDate(c.date);
}

function commentDate(value) {
  const d = parseTimestamp(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: EASTERN_TZ, month: 'short', day: 'numeric' });
}

function ClassCard({ c }) {
  const [allComments, setAllComments] = useState(false);
  const shown = allComments ? c.comments : c.comments.slice(0, COMMENTS_SHOWN);
  return (
    <div className="fb-class">
      <div className="fb-class-head">
        <div style={{ minWidth: 0 }}>
          <div className="fb-class-title">{shortTraining(c.training)}</div>
          <div className="fb-class-sub">{c.client} · {classDate(c)}</div>
        </div>
        <div className="fb-class-score">
          {c.avg_rating != null ? (
            <>
              <Stars value={c.avg_rating} />
              <span className="fb-class-num">{c.avg_rating.toFixed(1)}</span>
            </>
          ) : <span className="fb-class-sub">No ratings</span>}
          <div className="fb-class-sub">
            {c.responses} response{c.responses === 1 ? '' : 's'}
            {c.avg_effectiveness != null && ` · effectiveness ${c.avg_effectiveness.toFixed(1)}`}
          </div>
        </div>
      </div>
      {c.comments.length > 0 ? (
        <div className="fb-comments">
          {shown.map((m, i) => (
            <blockquote key={i} className="fb-quote">
              <p>&ldquo;{m.text}&rdquo;</p>
              <footer>{m.rating ? <Stars value={m.rating} size={12} /> : null} {commentDate(m.submitted_at)}</footer>
            </blockquote>
          ))}
          {c.comments.length > COMMENTS_SHOWN && (
            <button type="button" className="link-button" onClick={() => setAllComments((v) => !v)}>
              {allComments ? 'Show fewer comments' : `Show all ${c.comments.length} comments`}
            </button>
          )}
        </div>
      ) : (
        <p className="fb-none">No written comments for this class.</p>
      )}
    </div>
  );
}

export default function PortalFeedback({ ratings, feedback }) {
  const [onlyComments, setOnlyComments] = useState(false);
  const [showCount, setShowCount] = useState(CLASSES_STEP);
  const classes = feedback?.classes || [];
  const dist = feedback?.distribution || {};
  const totalRatings = [1, 2, 3, 4, 5].reduce((n, k) => n + (dist[k] || 0), 0);
  const listed = onlyComments ? classes.filter((c) => c.comments.length) : classes;

  return (
    <div className="card fb-card">
      <div className="fb-head">
        <div>
          <h2 style={{ margin: 0 }}>My Feedback</h2>
          <p className="page-subtitle" style={{ margin: '2px 0 0' }}>What trainees said about you. Responses are anonymous.</p>
        </div>
      </div>

      {totalRatings === 0 && !classes.length ? (
        <p className="empty-state" style={{ padding: 8, textAlign: 'left' }}>
          No feedback yet. It shows up here once trainees scan the gold FEEDBACK QR code at the end of your class.
        </p>
      ) : (
        <>
          <div className="fb-overview">
            <div className="fb-big">
              <div className="fb-big-num">{ratings.trainer_avg != null ? ratings.trainer_avg.toFixed(1) : '—'}</div>
              {ratings.trainer_avg != null && <Stars value={ratings.trainer_avg} size={18} />}
              <div className="fb-class-sub">{totalRatings} rating{totalRatings === 1 ? '' : 's'} · {classes.length} class{classes.length === 1 ? '' : 'es'}</div>
            </div>
            <div className="fb-bars" aria-label="How your ratings are spread">
              {[5, 4, 3, 2, 1].map((k) => {
                const n = dist[k] || 0;
                return (
                  <div key={k} className="fb-bar-row">
                    <span className="fb-bar-label">{k}★</span>
                    <span className="fb-bar-track"><span className="fb-bar-fill" style={{ width: `${totalRatings ? (n / totalRatings) * 100 : 0}%` }} /></span>
                    <span className="fb-bar-count">{n}</span>
                  </div>
                );
              })}
            </div>
            <div className="fb-side">
              <div className="fb-side-item">
                <div className="fb-side-num">{ratings.effectiveness_avg != null ? ratings.effectiveness_avg.toFixed(1) : '—'}</div>
                <div className="fb-class-sub">Training effectiveness</div>
              </div>
              <div className="fb-side-item">
                <div className="fb-side-num">{feedback?.comment_count || 0}</div>
                <div className="fb-class-sub">Written comments</div>
              </div>
            </div>
          </div>

          <div className="fb-list-head">
            <h3 style={{ margin: 0, fontSize: 14 }}>By class</h3>
            <label className="fb-toggle">
              <input type="checkbox" checked={onlyComments} onChange={(e) => { setOnlyComments(e.target.checked); setShowCount(CLASSES_STEP); }} />
              Only classes with comments
            </label>
          </div>
          <div className="fb-classes">
            {listed.slice(0, showCount).map((c) => <ClassCard key={c.session_id} c={c} />)}
            {!listed.length && <p className="fb-none">No classes with written comments yet.</p>}
          </div>
          {listed.length > showCount && (
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setShowCount((n) => n + CLASSES_STEP)}>
              Show more classes ({listed.length - showCount} more)
            </button>
          )}
        </>
      )}
    </div>
  );
}
