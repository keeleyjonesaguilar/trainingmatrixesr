import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import SignaturePad from '../components/SignaturePad';
import { AHA_COURSE_OPTIONS, AHA_COURSE_GROUPS } from '../lib/ahaCourseOptions';
import { AHA_OPTIONAL_TOPICS } from '../lib/ahaOptionalTopics';

// The one training this extra AHA-format section applies to (Keeley's request, 2026-09-21) -
// matches server/routes/publicSessions.js's AHA_ROSTER_TRAINING_ID.
const AHA_ROSTER_TRAINING_ID = 'TRN-020';

// Renders an <input type="datetime-local"> value ("2026-09-21T08:00") as the plain "9/21/2026
// 8:00 AM" style the printed AHA form expects. Deliberately does its own string parsing instead
// of round-tripping through `new Date(...)` - a datetime-local value is just wall-clock numbers
// with no timezone attached, and this app's whole convention is that a time typed in means
// Eastern, the business's own timezone, regardless of what timezone the trainer's phone/laptop
// happens to be set to (see client/src/lib/dates.js) - building a real Date object here would
// silently reinterpret those numbers through the device's local offset instead of leaving them
// exactly as entered.
function formatDateTimeLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return '';
  const [, year, month, day, hour24, minute] = match;
  const hour24Num = Number(hour24);
  const period = hour24Num >= 12 ? 'PM' : 'AM';
  const hour12 = hour24Num % 12 === 0 ? 12 : hour24Num % 12;
  return `${Number(month)}/${Number(day)}/${year} ${hour12}:${minute} ${period}`;
}

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
  email: { en: 'Email address', es: 'Correo electrónico' },
  signature: { en: 'Signature', es: 'Firma' },
  sign_in_button: { en: 'Sign In', es: 'Registrarse' },
  signing_in_ellipsis: { en: 'Signing in…', es: 'Registrando…' },
  person_signed_in_suffix: { en: 'person has signed in so far.', es: 'persona se ha registrado hasta ahora.' },
  people_signed_in_suffix: { en: 'people have signed in so far.', es: 'personas se han registrado hasta ahora.' },
  trainer_name: { en: 'Trainer name', es: 'Nombre del instructor' },
  trainer_phone: { en: 'Trainer phone number', es: 'Número de teléfono del instructor' },
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
  err_email: { en: 'Please enter a valid email address.', es: 'Por favor ingrese un correo electrónico válido.' },
  err_signature: { en: 'Please sign before submitting.', es: 'Por favor firme antes de enviar.' },
  err_trainer_name: { en: "Please enter the trainer's name.", es: 'Por favor ingrese el nombre del instructor.' },
  err_trainer_email: {
    en: "Please enter the trainer's email address.",
    es: 'Por favor ingrese el correo electrónico del instructor.',
  },
  err_trainer_phone: {
    en: "Please enter the trainer's phone number.",
    es: 'Por favor ingrese el número de teléfono del instructor.',
  },
  err_trainer_pin: { en: 'Please enter the trainer PIN.', es: 'Por favor ingrese el PIN del instructor.' },
  err_trainer_signature: {
    en: 'Trainer signature is required to close the session.',
    es: 'Se requiere la firma del instructor para cerrar la sesión.',
  },
};

// Returns the phrase for `key` in the session's language: English, Spanish, or (for "both")
// "English/Spanish" - matches the format Keeley asked for ("First Name/Nombre").
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [email, setEmail] = useState('');
  const [trainerName, setTrainerName] = useState('');
  const [trainerEmail, setTrainerEmail] = useState('');
  const [trainerPhone, setTrainerPhone] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [justSigned, setJustSigned] = useState(false);
  const [closedNow, setClosedNow] = useState(false);
  const sigRef = useRef(null);

  // AHA Heartsaver Course Roster fields (Keeley's request, 2026-09-21) - only ever shown/sent
  // when this session's training is First Aid/CPR/AED; every other training ignores them.
  const [hsCourseOptions, setHsCourseOptions] = useState([]);
  const [hsTrainingCenter, setHsTrainingCenter] = useState('');
  const [hsTrainingCenterId, setHsTrainingCenterId] = useState('');
  const [hsTrainingSiteName, setHsTrainingSiteName] = useState('');
  const [hsAddress, setHsAddress] = useState('');
  const [hsCityStateZip, setHsCityStateZip] = useState('');
  const [hsCourseStart, setHsCourseStart] = useState('');
  const [hsCourseEnd, setHsCourseEnd] = useState('');
  const [hsTotalHours, setHsTotalHours] = useState('');
  const [hsNoOfCardsIssued, setHsNoOfCardsIssued] = useState('');
  const [hsStudentManikinRatio, setHsStudentManikinRatio] = useState('');
  const [hsIssueDateOfCards, setHsIssueDateOfCards] = useState('');
  const [hsCardExpirationDate, setHsCardExpirationDate] = useState('');
  const [hsOptionalTopics, setHsOptionalTopics] = useState([]);
  const [hasAdditionalInstructors, setHasAdditionalInstructors] = useState(false);
  const [additionalInstructors, setAdditionalInstructors] = useState([{ name_id: '', card_exp_date: '' }]);

  const toggleHsOption = (key) => {
    setHsCourseOptions((prev) => {
      if (prev.includes(key)) {
        // Unchecking a top-level course also clears its own sub-options - they're meaningless
        // without the course they belong to.
        const subKeys = AHA_COURSE_OPTIONS.filter((o) => o.group === key).map((o) => o.key);
        return prev.filter((k) => k !== key && !subKeys.includes(k));
      }
      return [...prev, key];
    });
  };

  const toggleHsTopic = (key) => {
    setHsOptionalTopics((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const updateAdditionalInstructor = (index, field, value) => {
    setAdditionalInstructors((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addAdditionalInstructorRow = () => {
    setAdditionalInstructors((prev) => (prev.length >= 8 ? prev : [...prev, { name_id: '', card_exp_date: '' }]));
  };

  const removeAdditionalInstructorRow = (index) => {
    setAdditionalInstructors((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const load = () => {
    api
      .publicSessionInfo(token)
      .then(setInfo)
      .catch((err) => setLoadError(err.message));
  };

  useEffect(load, [token]);

  // Auto-load the trainer's name/phone/email from the session record and, if they're already on
  // file, their trainer profile (Keeley's request, 2026-09-17: eliminate retyping this every
  // session) - only seeds each field while still empty, so it never clobbers an in-progress
  // manual correction on a later refresh.
  useEffect(() => {
    if (info?.trainer_name && !trainerName) setTrainerName(info.trainer_name);
    if (info?.trainer_phone && !trainerPhone) setTrainerPhone(info.trainer_phone);
    if (info?.trainer_email && !trainerEmail) setTrainerEmail(info.trainer_email);
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
    if (!email.trim() || !EMAIL_PATTERN.test(email.trim())) return setFormError(t('err_email'));
    if (sigRef.current?.isEmpty()) return setFormError(t('err_signature'));
    setSubmitting(true);
    try {
      await api.publicSignIn(token, {
        trainee_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        trainee_phone: phone.trim(),
        trainee_job_title: jobTitle.trim(),
        trainee_email: email.trim(),
        signature: sigRef.current.toDataURL(),
      });
      setJustSigned(true);
      setFirstName('');
      setLastName('');
      setPhone('');
      setJobTitle('');
      setEmail('');
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
    if (!trainerEmail.trim() || !EMAIL_PATTERN.test(trainerEmail.trim())) return setFormError(t('err_trainer_email'));
    if (!trainerPhone.trim()) return setFormError(t('err_trainer_phone'));
    if (!pin.trim()) return setFormError(t('err_trainer_pin'));
    if (sigRef.current?.isEmpty()) return setFormError(t('err_trainer_signature'));
    setSubmitting(true);
    try {
      const isAhaSession = info?.master_training_id === AHA_ROSTER_TRAINING_ID;
      await api.publicCloseSession(token, {
        trainer_signed_name: trainerName.trim(),
        trainer_email: trainerEmail.trim(),
        trainer_phone: trainerPhone.trim(),
        pin: pin.trim(),
        signature: sigRef.current.toDataURL(),
        ...(isAhaSession
          ? {
              hs_course_options: hsCourseOptions,
              hs_training_center: hsTrainingCenter.trim(),
              hs_training_center_id: hsTrainingCenterId.trim(),
              hs_training_site_name: hsTrainingSiteName.trim(),
              hs_address: hsAddress.trim(),
              hs_city_state_zip: hsCityStateZip.trim(),
              hs_course_start: formatDateTimeLocal(hsCourseStart),
              hs_course_end: formatDateTimeLocal(hsCourseEnd),
              hs_total_hours: hsTotalHours.trim(),
              hs_no_of_cards_issued: hsNoOfCardsIssued.trim(),
              hs_student_manikin_ratio: hsStudentManikinRatio.trim(),
              hs_issue_date_of_cards: hsIssueDateOfCards.trim(),
              hs_card_expiration_date: hsCardExpirationDate.trim(),
              hs_optional_topics: hsOptionalTopics,
              hs_additional_instructors: hasAdditionalInstructors
                ? additionalInstructors.filter((row) => row.name_id.trim() || row.card_exp_date.trim()).slice(0, 8)
                : [],
            }
          : {}),
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
            {info.additional_training_labels?.map((label) => (
              <span key={label}> + {label}</span>
            ))}
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
                  <label>{t('email')}</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@example.com"
                    type="email"
                  />
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
                  <label>{t('email')}</label>
                  <input
                    value={trainerEmail}
                    onChange={(e) => setTrainerEmail(e.target.value)}
                    placeholder="trainer@example.com"
                    type="email"
                  />
                </div>
                <div className="field">
                  <label>{t('trainer_phone')}</label>
                  <input
                    value={trainerPhone}
                    onChange={(e) => setTrainerPhone(e.target.value)}
                    placeholder="(555) 123-4567"
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
                {info.master_training_id === AHA_ROSTER_TRAINING_ID && (
                  <div className="card" style={{ margin: '4px 0 16px', textAlign: 'left' }}>
                    <h3 style={{ marginTop: 0, fontSize: 14 }}>AHA Course Roster Details</h3>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6 }}>
                      Fills out the official AHA Heartsaver Course Roster for this class - leave anything blank that doesn't apply.
                    </p>
                    <div className="field">
                      <label>Course Type</label>
                      {AHA_COURSE_GROUPS.map((groupOpt) => (
                        <div key={groupOpt.key} style={{ marginBottom: 6 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                            <input
                              type="checkbox"
                              checked={hsCourseOptions.includes(groupOpt.key)}
                              onChange={() => toggleHsOption(groupOpt.key)}
                            />
                            {groupOpt.label}
                          </label>
                          {hsCourseOptions.includes(groupOpt.key) && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginLeft: 24, marginTop: 4 }}>
                              {AHA_COURSE_OPTIONS.filter((o) => o.group === groupOpt.key).map((sub) => (
                                <label key={sub.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}>
                                  <input
                                    type="checkbox"
                                    checked={hsCourseOptions.includes(sub.key)}
                                    onChange={() => toggleHsOption(sub.key)}
                                  />
                                  {sub.label}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="field">
                      <label>Training Center</label>
                      <input value={hsTrainingCenter} onChange={(e) => setHsTrainingCenter(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Training Center ID#</label>
                      <input value={hsTrainingCenterId} onChange={(e) => setHsTrainingCenterId(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Training Site Name (if applicable)</label>
                      <input value={hsTrainingSiteName} onChange={(e) => setHsTrainingSiteName(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Address</label>
                      <input value={hsAddress} onChange={(e) => setHsAddress(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>City, State ZIP</label>
                      <input value={hsCityStateZip} onChange={(e) => setHsCityStateZip(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Course Start Date/Time</label>
                      <input type="datetime-local" value={hsCourseStart} onChange={(e) => setHsCourseStart(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Course End Date/Time</label>
                      <input type="datetime-local" value={hsCourseEnd} onChange={(e) => setHsCourseEnd(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Total Hours of Instruction</label>
                      <input value={hsTotalHours} onChange={(e) => setHsTotalHours(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>No. of Cards Issued</label>
                      <input value={hsNoOfCardsIssued} onChange={(e) => setHsNoOfCardsIssued(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Student-Manikin Ratio</label>
                      <input value={hsStudentManikinRatio} onChange={(e) => setHsStudentManikinRatio(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Issue Date of Cards</label>
                      <input value={hsIssueDateOfCards} onChange={(e) => setHsIssueDateOfCards(e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Card Expiration Date</label>
                      <input value={hsCardExpirationDate} onChange={(e) => setHsCardExpirationDate(e.target.value)} />
                    </div>

                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                        <input
                          type="checkbox"
                          checked={hasAdditionalInstructors}
                          onChange={(e) => setHasAdditionalInstructors(e.target.checked)}
                        />
                        Any additional/assisting instructors?
                      </label>
                    </div>
                    {hasAdditionalInstructors && (
                      <div style={{ marginBottom: 12 }}>
                        {additionalInstructors.map((row, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                              <label>Name and Instructor ID#</label>
                              <input
                                value={row.name_id}
                                onChange={(e) => updateAdditionalInstructor(i, 'name_id', e.target.value)}
                              />
                            </div>
                            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                              <label>Card Exp. Date</label>
                              <input
                                value={row.card_exp_date}
                                onChange={(e) => updateAdditionalInstructor(i, 'card_exp_date', e.target.value)}
                              />
                            </div>
                            {additionalInstructors.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => removeAdditionalInstructorRow(i)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        {additionalInstructors.length < 8 && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={addAdditionalInstructorRow}>
                            + Add Another Instructor
                          </button>
                        )}
                      </div>
                    )}

                    <div className="field">
                      <label>Optional Topics Checklist</label>
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
                        Only relevant for course paths with optional topics (Office/Educator/Babysitter/Water Safety, etc.) - leave unchecked if none applied.
                      </p>
                      {[...new Set(AHA_OPTIONAL_TOPICS.map((t) => t.section))].map((section) => (
                        <div key={section} style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{section}</div>
                          {AHA_OPTIONAL_TOPICS.filter((t) => t.section === section).map((topic) => (
                            <label key={topic.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13, marginBottom: 2 }}>
                              <input
                                type="checkbox"
                                checked={hsOptionalTopics.includes(topic.key)}
                                onChange={() => toggleHsTopic(topic.key)}
                              />
                              {topic.label}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
