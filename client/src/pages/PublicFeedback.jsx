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

// Fixed feedback-page text (Keeley's request, 2026-09-16 - the sign-in page already had this,
// the feedback page from the second QR code didn't) - same "small, known set of phrases"
// approach as PublicSignIn.jsx's STRINGS, driven by the session's own language setting. The
// admin-editable questions themselves (info.labels) are real machine translations instead,
// cached on feedback_form_settings at save time - see server/routes/feedbackSettings.js.
const STRINGS = {
  heading: { en: 'Training Feedback', es: 'Comentarios sobre la capacitación' },
  trainer_label: { en: 'Trainer:', es: 'Instructor:' },
  trainers_label: { en: 'Trainers:', es: 'Instructores:' },
  thank_you: {
    en: 'Thank you — your feedback has been submitted.',
    es: 'Gracias — sus comentarios han sido enviados.',
  },
  select_ellipsis: { en: 'Select…', es: 'Seleccionar…' },
  yes: { en: 'Yes', es: 'Sí' },
  no: { en: 'No', es: 'No' },
  comment_placeholder: { en: "Anything you'd like to share...", es: 'Algo que le gustaría compartir...' },
  submitting_ellipsis: { en: 'Submitting…', es: 'Enviando…' },
  submit_button: { en: 'Submit Feedback', es: 'Enviar comentarios' },
  err_effectiveness: {
    en: 'Please rate how effective the training was.',
    es: 'Por favor califique qué tan efectiva fue la capacitación.',
  },
  err_trainer_rating: {
    en: "Please rate the trainer's performance.",
    es: 'Por favor califique el desempeño del instructor.',
  },
  err_rate_named: { en: 'Please rate', es: 'Por favor califique a' },
};

// Same shape as PublicSignIn.jsx's makeTranslator: English, Spanish, or "English/Spanish" for
// "both".
function makeTranslator(language) {
  return (key) => {
    const entry = STRINGS[key];
    if (!entry) return key;
    if (language === 'spanish') return entry.es;
    if (language === 'both') return `${entry.en}/${entry.es}`;
    return entry.en;
  };
}

// Picks the right text for one of the admin-editable questions: English, its cached Spanish
// translation (falling back to English if that field was never successfully translated), or
// both stacked together.
function labelText(labels, key, language) {
  const en = labels[`${key}_label`];
  const es = labels[`${key}_label_es`] || en;
  if (language === 'spanish') return es;
  if (language === 'both') return `${en}/${es}`;
  return en;
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
  // A rating and optional comment for each trainer (Keeley's request, 2026-10-01) - co-trainers
  // and each day's trainer on a multi-day course are rated separately.
  const [trainerAnswers, setTrainerAnswers] = useState({});
  const setAnswer = (key, patch) => setTrainerAnswers((prev) => ({ ...prev, [key]: { rating: 0, comment: '', ...prev[key], ...patch } }));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.publicFeedbackInfo(token).then(setInfo).catch((err) => setLoadError(err.message));
  }, [token]);

  const t = makeTranslator(info?.language || 'english');
  const trainers = info?.trainers?.length ? info.trainers : [{ key: 'lead', name: info?.trainer_name || '' }];

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!effectiveness) return setFormError(t('err_effectiveness'));
    const unrated = trainers.find((tr) => !trainerAnswers[tr.key]?.rating);
    if (unrated) return setFormError(trainers.length > 1 ? `${t('err_rate_named')} ${unrated.name}.` : t('err_trainer_rating'));
    setSubmitting(true);
    try {
      await api.publicSubmitFeedback(token, {
        could_ask_questions: couldAskQuestions || null,
        understood_material: understoodMaterial || null,
        needs_additional_training: needsAdditionalTraining || null,
        effectiveness_rating: effectiveness,
        trainer_ratings: trainers.map((tr) => ({
          key: tr.key,
          rating: trainerAnswers[tr.key].rating,
          comment: (trainerAnswers[tr.key].comment || '').trim() || null,
        })),
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

  const language = info.language || 'english';
  const trainingLabel =
    language === 'spanish'
      ? info.training_type_label_es || info.training_type_label
      : language === 'both'
        ? `${info.training_type_label}/${info.training_type_label_es || info.training_type_label}`
        : info.training_type_label;

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>{t('heading')}</h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {trainingLabel} · {info.client_name} · {formatDate(info.session_date)}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>
            {trainers.length > 1 ? t('trainers_label') : t('trainer_label')} {trainers.map((tr) => tr.name).join(', ')}
          </div>
        </div>

        {submitted ? (
          <div className="card">
            <p className="success-banner" style={{ margin: 0 }}>{t('thank_you')}</p>
          </div>
        ) : (
          <div className="card">
            {formError && <p className="error-banner">{formError}</p>}
            <form onSubmit={submit}>
              <div className="field">
                <label>{labelText(info.labels, 'could_ask_questions', language)}</label>
                <select value={couldAskQuestions} onChange={(e) => setCouldAskQuestions(e.target.value)}>
                  <option value="">{t('select_ellipsis')}</option>
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </div>
              <div className="field">
                <label>{labelText(info.labels, 'understood_material', language)}</label>
                <select value={understoodMaterial} onChange={(e) => setUnderstoodMaterial(e.target.value)}>
                  <option value="">{t('select_ellipsis')}</option>
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </div>
              <div className="field">
                <label>{labelText(info.labels, 'needs_additional_training', language)}</label>
                <select value={needsAdditionalTraining} onChange={(e) => setNeedsAdditionalTraining(e.target.value)}>
                  <option value="">{t('select_ellipsis')}</option>
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </div>
              <div className="field">
                <label>{labelText(info.labels, 'effectiveness', language)}</label>
                <StarRating value={effectiveness} onChange={setEffectiveness} />
              </div>
              {trainers.map((tr) => (
                <div
                  key={tr.key}
                  style={trainers.length > 1 ? { border: '1px solid var(--color-border)', borderRadius: 4, padding: '10px 12px', marginBottom: 12 } : undefined}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{tr.name}</div>
                  <div className="field">
                    <label>{labelText(info.labels, 'trainer_rating', language)}</label>
                    <StarRating value={trainerAnswers[tr.key]?.rating || 0} onChange={(v) => setAnswer(tr.key, { rating: v })} />
                  </div>
                  <div className="field" style={trainers.length > 1 ? { marginBottom: 0 } : undefined}>
                    <label>{labelText(info.labels, 'comment', language)}</label>
                    <textarea
                      rows={3}
                      value={trainerAnswers[tr.key]?.comment || ''}
                      onChange={(e) => setAnswer(tr.key, { comment: e.target.value })}
                      placeholder={t('comment_placeholder')}
                    />
                  </div>
                </div>
              ))}
              <button className="btn btn-accent" type="submit" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? t('submitting_ellipsis') : t('submit_button')}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
