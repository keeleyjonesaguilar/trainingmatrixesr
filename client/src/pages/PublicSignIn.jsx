import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import SignaturePad from '../components/SignaturePad';

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Fixed sign-in page text (Keeley's request): translated once here rather than through the
// translation API, since it's a small, known set of phrases that never changes - only the
// per-session training name/outline (typed in by an admin) needs real machine translation,
// cached on the session itself (see server/lib/translate.js).
const STRINGS = {
  signing_in_tab: { en: "I'm signing in", es: 'Estoy firmando' },
  trainer_tab: { en: "I'm the trainer — close session", es: 'Soy el instructor — cerrar sesión' },
  signed_in_banner: { en: "You're signed in!", es: '¡Ya está registrado!' },
  first_name: { en: 'First name', es: 'Nombre' },
  last_name: { en: 'Last name', es: 'Apellido' },
  phone_number: { en: 'Phone number', es: 'Número de teléfono' },
  job_title: { en: 'Job title', es: 'Puesto de trabajo' },
  signature: { en: 'Signature', es: 'Firma' },
  sign_in_button: { en: 'Sign In', es: 'Registrarse' },
  signing_in_ellipsis: { en: 'Signing in…', es: 'Registrando…' },
  person_signed_in_suffix: { en: 'person has signed in so far.', es: 'persona se ha registrado hasta ahora.' },
  people_signed_in_suffix: { en: 'people have signed in so far.', es: 'personas se han registrado hasta ahora.' },
  trainer_name: { en: 'Trainer name', es: 'Nombre del instructor' },
  trainer_pin: { en: 'Trainer PIN', es: 'PIN del instructor' },
  trainer_signature: { en: 'Trainer signature', es: 'Firma del instructor' },
  close_note: {
    en: 'Only close the session once everyone has signed in — the roster locks immediately and certificates are generated automatically.',
    es: 'Cierre la sesión solo cuando todos hayan firmado — la lista se bloquea de inmediato y los certificados se generan automáticamente.',
  },
  close_session_label: { en: 'Close Session', es: 'Cerrar sesión' },
  signed_in_label: { en: 'signed in', es: 'registrados' },
  closing_ellipsis: { en: 'Closing…', es: 'Cerrando…' },
  closed_now_banner: {
    en: 'Session closed. Thank you — the roster and certificates have been generated.',
    es: 'Sesión cerrada. Gracias — la lista y los certificados se han generado.',
  },
  closed_already_banner: {
    en: 'This training session has been closed and is no longer accepting sign-ins.',
    es: 'Esta sesión de capacitación se ha cerrado y ya no acepta registros.',
  },
  today_outline: { en: "Today's outline", es: 'Temario de hoy' },
  trainer_label: { en: 'Trainer:', es: 'Instructor:' },
  err_first_name: { en: 'Please enter your first name.', es: 'Por favor ingrese su nombre.' },
  err_last_name: { en: 'Please enter your last name.', es: 'Por favor ingrese su apellido.' },
  err_phone: { en: 'Please enter your phone number.', es: 'Por favor ingrese su número de teléfono.' },
  err_job_title: { en: 'Please enter your job title.', es: 'Por favor ingrese su puesto de trabajo.' },
  err_signature: { en: 'Please sign before submitting.', es: 'Por favor firme antes de enviar.' },
  err_trainer_name: { en: "Please enter the trainer's name.", es: 'Por favor ingrese el nombre del instructor.' },
  err_trainer_pin: { en: 'Please enter the trainer PIN.', es: 'Por favor ingrese el PIN del instructor.' },
  err_trainer_signature: {
    en: 'Trainer signature is required to close the session.',
    es: 'Se requiere la firma del instructor para cerrar la sesión.',
  },
};

// Returns the phrase for `key` in the session's language: English, Spanish, or (for "both")
// "English/Spanish" - matches the format Keeley asked for ("First Name/Nombre").
function makeTranslator(language) {
  return (key) => {
    const entry = STRINGS[key];
    if (!entry) return key;
    if (language === 'spanish') return entry.es;
    if (language === 'both') return `${entry.en}/${entry.es}`;
    return entry.en;
  };
}

export default function PublicSignIn() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('trainee'); // "trainee" | "trainer"
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [justSigned, setJustSigned] = useState(false);
  const [closedNow, setClosedNow] = useState(false);
  const sigRef = useRef(null);

  const load = () => {
    api
      .publicSessionInfo(token)
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  };

  useEffect(load, [token]);

  // Auto-load the trainer's name from the session record (Keeley's request) - only seeds it
  // while still empty, so it never clobbers an in-progress manual correction on a later refresh.
  useEffect(() => {
    if (info?.trainer_name && !trainerName) setTrainerName(info.trainer_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  const t = makeTranslator(info?.language || 'english');

  const handleTraineeSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!firstName.trim()) return setFormError(t('err_first_name'));
    if (!lastName.trim()) return setFormError(t('err_last_name'));
    if (!phone.trim()) return setFormError(t('err_phone'));
    if (!jobTitle.trim()) return setFormError(t('err_job_title'));
    if (sigRef.current?.isEmpty()) return setFormError(t('err_signature'));
    setSubmitting(true);
    try {
      await api.publicSignIn(token, {
        trainee_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        trainee_phone: phone.trim(),
        trainee_job_title: jobTitle.trim(),
        signature: sigRef.current.toDataURL(),
      });
      setJustSigned(true);
      setFirstName('');
      setLastName('');
      setPhone('');
      setJobTitle('');
      sigRef.current?.clear();
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrainerClose = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!trainerName.trim()) return setFormError(t('err_trainer_name'));
    if (!pin.trim()) return setFormError(t('err_trainer_pin'));
    if (sigRef.current?.isEmpty()) return setFormError(t('err_trainer_signature'));
    setSubmitting(true);
    try {
      await api.publicCloseSession(token, {
        trainer_signed_name: trainerName.trim(),
        pin: pin.trim(),
        signature: sigRef.current.toDataURL(),
      });
      setClosedNow(true);
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

  const isClosed = info.status === 'closed' || closedNow;
  const isBoth = info.language === 'both';
  const isSpanish = info.language === 'spanish';
  const trainingLabelEs = info.training_type_label_es || info.training_type_label;
  const outlineEs = info.outline_es || info.outline;

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>
            {isSpanish ? trainingLabelEs : isBoth ? `${info.training_type_label}/${trainingLabelEs}` : info.training_type_label}
          </h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {info.client_name} · {formatDate(info.session_date)}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>
            {t('trainer_label')} {info.trainer_name}
          </div>
        </div>

        {info.outline && (
          <div className="card" style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 13 }}>{t('today_outline')}</strong>
            {isBoth ? (
              <>
                <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{info.outline}</p>
                <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{outlineEs}</p>
              </>
            ) : (
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
                {isSpanish ? outlineEs : info.outline}
              </p>
            )}
          </div>
        )}

        {isClosed ? (
          <div className="card">
            <p className="success-banner" style={{ margin: 0 }}>
              {closedNow ? t('closed_now_banner') : t('closed_already_banner')}
            </p>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={mode === 'trainee' ? 'btn' : 'btn btn-secondary'}
                onClick={() => {
                  setMode('trainee');
                  setFormError('');
                }}
              >
                {t('signing_in_tab')}
              </button>
              <button
                type="button"
                className={mode === 'trainer' ? 'btn btn-accent' : 'btn btn-secondary'}
                onClick={() => {
                  setMode('trainer');
                  setFormError('');
                }}
              >
                {t('trainer_tab')}
              </button>
            </div>

            {formError && <p className="error-banner">{formError}</p>}

            {justSigned && mode === 'trainee' && (
              <p className="success-banner">{t('signed_in_banner')}</p>
            )}

            {mode === 'trainee' ? (
              <form onSubmit={handleTraineeSubmit}>
                <div className="field">
                  <label>{t('first_name')}</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
                </div>
                <div className="field">
                  <label>{t('last_name')}</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
                </div>
                <div className="field">
                  <label>{t('phone_number')}</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div className="field">
                  <label>{t('job_title')}</label>
                  <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Electrician" />
                </div>
                <div className="field">
                  <label>{t('signature')}</label>
                  <SignaturePad ref={sigRef} />
                </div>
                <button className="btn btn-accent" type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? t('signing_in_ellipsis') : t('sign_in_button')}
                </button>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
                  {info.attendee_count} {t(info.attendee_count === 1 ? 'person_signed_in_suffix' : 'people_signed_in_suffix')}
                </p>
              </form>
            ) : (
              <form onSubmit={handleTrainerClose}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('close_note')}</p>
                <div className="field">
                  <label>{t('trainer_name')}</label>
                  <input
                    value={trainerName}
                    onChange={(e) => setTrainerName(e.target.value)}
                    placeholder="Trainer name"
                  />
                </div>
                <div className="field">
                  <label>{t('trainer_pin')}</label>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="PIN"
                    type="password"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label>{t('trainer_signature')}</label>
                  <SignaturePad ref={sigRef} />
                </div>
                <button className="btn btn-danger" type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? t('closing_ellipsis') : `${t('close_session_label')} (${info.attendee_count} ${t('signed_in_label')})`}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
