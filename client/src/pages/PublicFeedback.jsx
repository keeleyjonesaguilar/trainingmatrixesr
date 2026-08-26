import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import StarRating from '../components/StarRating.jsx';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Anonymous post-training feedback form, reached only via a closed session's second QR code.
// No login/name field (Keeley's design: anonymous, no attendee link) - same public-shell/
// public-card layout as PublicSignIn.jsx for visual consistency.
export default function PublicFeedback() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [couldAskQuestions, setCouldAskQuestions] = useState('');
  const [understoodMaterial, setUnderstoodMaterial] = useState('');
  const [needsAdditionalTraining, setNeedsAdditionalTraining] = useState('');
  const [effectiveness, setEffectiveness] = useState(0);
  const [trainerRating, setTrainerRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.publicFeedbackInfo(token).then(setInfo).catch((err) => setLoadError(err.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!effectiveness) return setFormError('Please rate how effective the training was.');
    if (!trainerRating) return setFormError("Please rate the trainer's performance.");
    setSubmitting(true);
    try {
      await api.publicSubmitFeedback(token, {
        could_ask_questions: couldAskQuestions || null,
        understood_material: understoodMaterial || null,
        needs_additional_training: needsAdditionalTraining || null,
        effectiveness_rating: effectiveness,
        trainer_rating: trainerRating,
        trainer_comment: comment.trim() || null,
      });
      setSubmitted(true);
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

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>Training Feedback</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {info.training_type_label} · {info.client_name} · {formatDate(info.session_date)}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>
            Trainer: {info.trainer_name}
          </div>
        </div>

        {submitted ? (
          <div className="card">
            <p className="success-banner" style={{ margin: 0 }}>Thank you — your feedback has been submitted.</p>
          </div>
        ) : (
          <div className="card">
            {formError && <p className="error-banner">{formError}</p>}
            <form onSubmit={submit}>
              <div className="field">
                <label>{info.labels.could_ask_questions_label}</label>
                <select value={couldAskQuestions} onChange={(e) => setCouldAskQuestions(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="field">
                <label>{info.labels.understood_material_label}</label>
                <select value={understoodMaterial} onChange={(e) => setUnderstoodMaterial(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="field">
                <label>{info.labels.needs_additional_training_label}</label>
                <select value={needsAdditionalTraining} onChange={(e) => setNeedsAdditionalTraining(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="field">
                <label>{info.labels.effectiveness_label}</label>
                <StarRating value={effectiveness} onChange={setEffectiveness} />
              </div>
              <div className="field">
                <label>{info.labels.trainer_rating_label}</label>
                <StarRating value={trainerRating} onChange={setTrainerRating} />
              </div>
              <div className="field">
                <label>{info.labels.comment_label}</label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Anything you'd like to share..."
                />
              </div>
              <button className="btn btn-accent" type="submit" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Submitting…' : 'Submit Feedback'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
