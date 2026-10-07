import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import esrMark from '../assets/brand/esr-mark.png';
import SignaturePad from '../components/SignaturePad';
import AhaRosterFields, { AHA_ROSTER_TRAINING_ID, EMPTY_AHA_FIELDS, ahaFieldsPayload } from '../components/AhaRosterFields';
import { formatShortDate, parseTimestamp, EASTERN_TZ } from '../lib/dates';

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
  // A multi-day course's trainer signs off each day before the last (Keeley's request, 2026-09-29).
  trainer_tab_signoff: { en: "I'm the trainer — end of Day {day} sign-off", es: 'Soy el instructor — firma al final del Día {day}' },
  // Asked right before a day's sign-off goes through (Keeley's request, 2026-09-30: a trainer
  // signed off Day 2 at the start of class, so the rest of the day's sign-ins went to Day 3).
  signoff_confirm: {
    en: "Sign off Day {day} now?\n\nOnly do this at the END of today's class, after everyone has signed in. Anyone who signs in after this is recorded for Day {next}.",
    es: '¿Firmar el Día {day} ahora?\n\nHágalo solo al FINAL de la clase de hoy, cuando todos se hayan registrado. Quien se registre después quedará en el Día {next}.',
  },
  signoff_note: {
    en: "Do this at the END of today's class, after everyone has signed in. It closes Day {day} and opens Day {next} - anyone who signs in after this is recorded for Day {next}. Certificates are only created when the final day is closed out.",
    es: 'Hágalo al FINAL de la clase de hoy, cuando todos se hayan registrado. Cierra el Día {day} y abre el Día {next} - quien se registre después quedará en el Día {next}. Los certificados solo se crean al cerrar el último día.',
  },
  signoff_button: { en: 'Sign Off End of Day {day}', es: 'Firmar el final del Día {day}' },
  signing_off_ellipsis: { en: 'Signing off…', es: 'Firmando…' },
  signed_off_banner: {
    en: 'Day {day} is signed off. Thank you! Day {next} is now open for sign-ins.',
    es: '¡El Día {day} está firmado. Gracias! El Día {next} ya está abierto para registros.',
  },
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
  who_closing: { en: 'Which trainer is closing out?', es: '¿Qué instructor está cerrando?' },
  trainer_phone: { en: 'Trainer phone number', es: 'Número de teléfono del instructor' },
  trainer_pin: { en: 'Trainer PIN', es: 'PIN del instructor' },
  trainer_signature: { en: 'Trainer signature', es: 'Firma del instructor' },
  close_note: {
    en: 'Only close the session once everyone has signed in — the roster locks immediately and certificates are generated automatically.',
    es: 'Cierre la sesión solo cuando todos hayan firmado — la lista se bloquea de inmediato y los certificados se generan automáticamente.',
  },
  close_session_label: { en: 'Close Session', es: 'Cerrar sesión' },
  // Toolbox talks have no certificates (Keeley's request, 2026-09-30).
  close_note_toolbox: {
    en: "Only close the toolbox talk once everyone has signed in — the roster locks immediately and attendance is recorded on each person's profile.",
    es: 'Cierre la charla solo cuando todos se hayan registrado — la lista se bloquea de inmediato y la asistencia queda registrada en el perfil de cada persona.',
  },
  closed_now_banner_toolbox: {
    en: 'Toolbox talk closed. Thank you — the roster has been generated.',
    es: 'Charla cerrada. Gracias — la lista se ha generado.',
  },
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
  // Multi-day training (Keeley's request, 2026-09-21/22): one QR code covers every day of a
  // course like OSHA 30, so the sign-in page needs to show which day is open and let a returning
  // attendee find themselves instead of re-typing their whole profile every day.
  day_progress: { en: 'Day {day} of {total}', es: 'Día {day} de {total}' },
  multi_day_notice: {
    en: 'You must sign in every day of this course for it to count toward your certificate.',
    es: 'Debe registrarse todos los días de este curso para que cuente para su certificado.',
  },
  // Worded around "have you been here before" (Keeley's report, 2026-09-30: returning attendees on
  // Day 2 picked "first time" and ended up with a second entry missing Day 1).
  choice_first_time_title: { en: 'This is my first day of this course', es: 'Este es mi primer día de este curso' },
  choice_first_time_sub: {
    en: 'I did NOT sign in on any earlier day',
    es: 'NO me registré en ningún día anterior',
  },
  choice_returning_title: { en: 'I was here on an earlier day', es: 'Estuve aquí en un día anterior' },
  choice_returning_sub: { en: 'Find my name and sign in for Day {day}', es: 'Buscar mi nombre y registrarme para el Día {day}' },
  choice_hint_later_day: {
    en: 'Were you here on an earlier day of this course? Choose "I was here on an earlier day" - do not sign up again.',
    es: '¿Estuvo aquí en un día anterior de este curso? Elija "Estuve aquí en un día anterior" - no se registre de nuevo.',
  },
  find_name_title: { en: 'Find your name', es: 'Busque su nombre' },
  find_name_placeholder: { en: 'Start typing your name…', es: 'Empiece a escribir su nombre…' },
  find_name_no_results: { en: "Can't find your name?", es: '¿No encuentra su nombre?' },
  find_name_switch_new: { en: 'Sign in as a new attendee', es: 'Registrarse como nuevo participante' },
  find_name_back: { en: '← Back', es: '← Atrás' },
  find_name_already_today: { en: 'signed in today', es: 'registrado hoy' },
  find_name_signed_days: { en: 'signed in Day(s)', es: 'registrado el/los Día(s)' },
  confirm_checkin_title: { en: "Confirm it's you — sign for today", es: 'Confirme que es usted — firme por hoy' },
  confirm_checkin_button: { en: 'Confirm & Check In', es: 'Confirmar y registrarse' },
  checking_in_ellipsis: { en: 'Checking in…', es: 'Registrando…' },
  checkin_success_banner: { en: "You're checked in for today!", es: '¡Está registrado para hoy!' },
  // Multi Training Day (Keeley's request, 2026-10-05): several trainings back to back on one day,
  // checking in again at the start of each one.
  mtd_title: { en: 'Multi Training Day', es: 'Día de capacitación múltiple' },
  mtd_progress: { en: 'Training {n} of {total}', es: 'Capacitación {n} de {total}' },
  mtd_notice: {
    en: 'Scan this QR code and check in at the start of EACH training. You only get a certificate for the trainings you check in for.',
    es: 'Escanee este código QR y regístrese al inicio de CADA capacitación. Solo recibe certificado de las capacitaciones en las que se registre.',
  },
  mtd_now_open: { en: 'Now checking in for:', es: 'Registro abierto para:' },
  mtd_choice_first_title: { en: 'This is my first training today', es: 'Esta es mi primera capacitación de hoy' },
  mtd_choice_first_sub: { en: 'I have NOT checked in for an earlier training today', es: 'NO me registré en una capacitación anterior hoy' },
  mtd_choice_returning_title: { en: 'I checked in for an earlier training today', es: 'Me registré en una capacitación anterior hoy' },
  mtd_choice_returning_sub: { en: 'Find my name and check in for {training}', es: 'Buscar mi nombre y registrarme para {training}' },
  mtd_choice_hint: {
    en: 'Checked in for an earlier training today? Choose "I checked in for an earlier training today" - do not sign up again.',
    es: '¿Se registró en una capacitación anterior hoy? Elija "Me registré en una capacitación anterior hoy" - no se registre de nuevo.',
  },
  mtd_already_now: { en: 'checked in for this training', es: 'registrado en esta capacitación' },
  mtd_checked_in_for: { en: 'checked in for', es: 'registrado en' },
  mtd_confirm_title: { en: "Confirm it's you — sign for {training}", es: 'Confirme que es usted — firme para {training}' },
  mtd_checkin_success: { en: "You're checked in for {training}!", es: '¡Está registrado para {training}!' },
  mtd_trainer_tab_next: { en: "I'm the trainer — start next training", es: 'Soy el instructor — iniciar la siguiente capacitación' },
  mtd_next_note: {
    en: 'Do this when {current} is over. It opens {next} for check-in - everyone scans this QR code again and checks in for it. Certificates are created when you close the session after the last training.',
    es: 'Hágalo cuando termine {current}. Abre {next} para el registro - todos escanean este código QR otra vez y se registran. Los certificados se crean al cerrar la sesión después de la última capacitación.',
  },
  mtd_next_button: { en: 'Start {next}', es: 'Iniciar {next}' },
  mtd_next_confirm: {
    en: 'Start {next} now?\n\nOnly do this when {current} is over. Anyone who checks in after this is checked in for {next}.',
    es: '¿Iniciar {next} ahora?\n\nHágalo solo cuando termine {current}. Quien se registre después quedará registrado en {next}.',
  },
  mtd_next_banner: { en: '{next} is open - everyone can scan the QR code to check in for it.', es: '{next} está abierta - todos pueden escanear el código QR para registrarse.' },
  starting_ellipsis: { en: 'Starting…', es: 'Iniciando…' },
  // The trainer's live roster (Keeley's request, 2026-10-07).
  roster_title: { en: "Who's signed in", es: 'Quién se ha registrado' },
  roster_pin_hint: { en: 'Enter the trainer PIN to see the list.', es: 'Ingrese el PIN del instructor para ver la lista.' },
  roster_show: { en: 'Show List', es: 'Ver lista' },
  roster_loading: { en: 'Loading…', es: 'Cargando…' },
  roster_refresh: { en: 'Refresh', es: 'Actualizar' },
  roster_hide: { en: 'Hide', es: 'Ocultar' },
  roster_empty: { en: 'No one has signed in yet.', es: 'Nadie se ha registrado todavía.' },
  roster_signed_at: { en: 'Signed in', es: 'Registrado' },
  roster_here_today: { en: 'Here today', es: 'Presente hoy' },
  roster_not_today: { en: 'Not signed in today', es: 'No registrado hoy' },
  roster_here_training: { en: 'Checked in', es: 'Registrado' },
  roster_not_training: { en: 'Not checked in yet', es: 'Aún no registrado' },
  roster_today_count: { en: '{n} of {total} signed in for today', es: '{n} de {total} registrados hoy' },
  roster_training_count: { en: '{n} of {total} checked in for {training}', es: '{n} de {total} registrados para {training}' },
  roster_days: { en: 'Days', es: 'Días' },
  roster_duplicate: { en: 'Possible duplicate', es: 'Posible duplicado' },
  roster_duplicate_note: {
    en: 'Flagged names may have signed in twice. Close out as normal - then remove the extra entry from the Edit Close-Out Details link in your email.',
    es: 'Los nombres marcados pueden haberse registrado dos veces. Cierre como siempre - luego elimine la entrada extra desde el enlace "Edit Close-Out Details" de su correo.',
  },
};

// "TRN-016 - Fall Protection" -> "Fall Protection" for the small step labels.
function shortTraining(label) {
  return String(label || '').replace(/^TRN-\d+\s*-\s*/, '');
}

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

// "Day {day} of {total}" has to fill in numbers, so it can't be a plain STRINGS lookup like
// everything else on this page.
function dayProgressLabel(t, day, total) {
  return t('day_progress').replace('{day}', day).replace('{total}', total);
}

// Returning-attendee flow for a multi-day session (Keeley's request, 2026-09-21/22): search by
// name instead of re-typing a whole profile every day, then sign fresh for whichever day is
// currently open. Debounced live search (a fresh keystroke cancels the previous lookup) over a
// small, single-session roster - server/routes/publicSessions.js's plain substring match, not
// the word-set matching used for import de-duplication (which answers a different question: "is
// this the exact same words in different order," not "does this look like what's been typed so
// far").
function ReturningAttendeeFlow({ token, t, onBack, onDone, trainings = null, currentDay = null }) {
  const currentTraining = trainings?.[currentDay - 1];
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sigRef = useRef(null);

  useEffect(() => {
    setSelected(null);
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .publicSearchAttendees(token, query.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [token, query]);

  const confirmCheckIn = async () => {
    setError('');
    if (sigRef.current?.isEmpty()) return setError(t('err_signature'));
    setSubmitting(true);
    try {
      await api.publicCheckinAttendee(token, selected.attendee_id, {
        signature: sigRef.current.toDataURL(),
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button type="button" className="link-button" onClick={onBack} style={{ marginBottom: 10 }}>
        {t('find_name_back')}
      </button>
      <div className="field">
        <label>{t('find_name_title')}</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('find_name_placeholder')}
          autoFocus
        />
      </div>
      {error && <p className="error-banner">{error}</p>}
      {!searching && query.trim().length >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {results.map((r) => {
            const isSelected = selected?.attendee_id === r.attendee_id;
            const initials = r.trainee_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
            const meta = r.already_checked_in_today
              ? t(trainings ? 'mtd_already_now' : 'find_name_already_today')
              : r.days_attended.length
                ? trainings
                  ? `${t('mtd_checked_in_for')} ${r.days_attended.map((d) => shortTraining(trainings[d - 1]?.label)).join(', ')}`
                  : `${t('find_name_signed_days')} ${r.days_attended.join(', ')}`
                : '';
            return (
              <button
                key={r.attendee_id}
                type="button"
                className="btn btn-secondary"
                style={{
                  textAlign: 'left', justifyContent: 'flex-start', gap: 12, padding: '12px 14px', height: 'auto',
                  border: isSelected ? '2px solid var(--esr-green)' : '1px solid var(--color-border)',
                }}
                onClick={() => setSelected(r)}
                disabled={r.already_checked_in_today}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--status-na-bg)', color: 'var(--status-na-text)', fontSize: 13, fontWeight: 700,
                }}>
                  {initials}
                </span>
                <span style={{ flexGrow: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{r.trainee_name}</span>
                  {meta && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>{meta}</span>}
                </span>
                {isSelected && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--esr-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
          {results.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('find_name_no_results')}{' '}
              <button type="button" className="link-button" onClick={onBack}>
                {t('find_name_switch_new')}
              </button>
            </p>
          )}
        </div>
      )}
      {selected && !selected.already_checked_in_today && (
        <div className="card" style={{ textAlign: 'left' }}>
          <strong style={{ fontSize: 13 }}>
            {trainings ? t('mtd_confirm_title').replaceAll('{training}', shortTraining(currentTraining?.label)) : t('confirm_checkin_title')}
          </strong>
          <div className="field" style={{ marginTop: 8 }}>
            <SignaturePad ref={sigRef} />
          </div>
          <button className="btn btn-accent" type="button" disabled={submitting} style={{ width: '100%' }} onClick={confirmCheckIn}>
            {submitting ? t('checking_in_ellipsis') : t('confirm_checkin_button')}
          </button>
        </div>
      )}
    </div>
  );
}

// The trainer's live roster (Keeley's request, 2026-10-07: trainers kept asking the office who had
// signed in) - shown on the trainer tab behind the trainer PIN. It shares the close-out form's
// `pin`, so the PIN typed here is already filled in when they close out. Refreshes itself every
// 20 seconds while open; names and sign-in times only (server/routes/publicSessions.js /roster).
function LiveRoster({ token, t, pin, setPin, info, trainings }) {
  const [roster, setRoster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (quiet = false) => {
    if (!quiet) {
      setError('');
      if (!pin.trim()) return setError(t('err_trainer_pin'));
      setBusy(true);
    }
    try {
      setRoster(await api.publicRoster(token, pin.trim()));
    } catch (err) {
      if (!quiet) setError(err.message);
    } finally {
      if (!quiet) setBusy(false);
    }
    return undefined;
  };

  useEffect(() => {
    if (!roster) return undefined;
    const handle = setInterval(() => load(true), 20000);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(roster), pin]);

  const isMultiPart = Number(info.total_days) > 1;
  const isMtd = Boolean(info.multi_training_day) && Array.isArray(trainings);
  const list = roster?.attendees || [];
  const hereNow = list.filter((a) => a.here_now).length;
  const timeOf = (value) => {
    const d = parseTimestamp(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: EASTERN_TZ, hour: 'numeric', minute: '2-digit' });
  };
  const detail = (a) => {
    if (isMtd) return a.days_attended.map((d) => shortTraining(trainings[d - 1]?.label)).join(', ');
    if (isMultiPart) return `${t('roster_days')} ${a.days_attended.join(', ') || '—'}`;
    return `${t('roster_signed_at')} ${timeOf(a.signed_at)}`;
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>{t('roster_title')} ({roster ? list.length : info.attendee_count})</strong>
        {roster && (
          <span style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="link-button" disabled={busy} onClick={() => load()}>{busy ? t('roster_loading') : t('roster_refresh')}</button>
            <button type="button" className="link-button" onClick={() => setRoster(null)}>{t('roster_hide')}</button>
          </span>
        )}
      </div>
      {error && <p className="error-banner" style={{ margin: '10px 0 0' }}>{error}</p>}
      {!roster ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0 10px' }}>{t('roster_pin_hint')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } }}
              placeholder="PIN"
              type="password"
              autoComplete="off"
              aria-label={t('trainer_pin')}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => load()}>
              {busy ? t('roster_loading') : t('roster_show')}
            </button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8 }}>
          {isMultiPart && list.length > 0 && (
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--esr-green)', margin: '0 0 6px' }}>
              {(isMtd ? t('roster_training_count') : t('roster_today_count'))
                .replaceAll('{n}', hereNow)
                .replaceAll('{total}', list.length)
                .replaceAll('{training}', isMtd ? shortTraining(trainings[info.current_day - 1]?.label) : '')}
            </p>
          )}
          {list.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{t('roster_empty')}</p>}
          {list.map((a, i) => (
            <div key={a.attendee_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--color-border)' }}>
              <span style={{ width: 20, fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {a.trainee_name}
                  {a.possible_duplicate && (
                    <span className="badge badge-expiringsoon" style={{ marginLeft: 6, fontSize: 10 }}>{t('roster_duplicate')}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{detail(a)}</div>
              </div>
              {isMultiPart && (
                <span className={`badge ${a.here_now ? 'badge-current' : 'badge-missing'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                  {isMtd ? t(a.here_now ? 'roster_here_training' : 'roster_not_training') : t(a.here_now ? 'roster_here_today' : 'roster_not_today')}
                </span>
              )}
            </div>
          ))}
          {list.some((a) => a.possible_duplicate) && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>{t('roster_duplicate_note')}</p>
          )}
        </div>
      )}
    </div>
  );
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
  // The day this trainer just signed off (multi-day), for the confirmation banner.
  const [signedOffDay, setSignedOffDay] = useState(null);
  // The training a Multi Training Day's trainer just opened, for the confirmation banner.
  const [openedTraining, setOpenedTraining] = useState('');
  const sigRef = useRef(null);

  // Multi-day session (Keeley's request, 2026-09-21/22): before showing the sign-in form, an
  // attendee first picks whether this is their first time on this course or they're returning to
  // check in for today - single-day sessions skip this entirely and go straight to 'new' below.
  const [signInStep, setSignInStep] = useState('choice'); // 'choice' | 'new' | 'returning'
  const [justCheckedIn, setJustCheckedIn] = useState(false);

  // AHA Heartsaver Course Roster fields (Keeley's request, 2026-09-21) - only ever shown/sent
  // when this session's training is First Aid/CPR/AED; every other training ignores them.
  const [ahaFields, setAhaFields] = useState(EMPTY_AHA_FIELDS);

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
        trainee_first_name: firstName.trim(),
        trainee_last_name: lastName.trim(),
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

  // Multi Training Day: between trainings the trainer only enters the PIN to open the next one.
  const handleNextTraining = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!pin.trim()) return setFormError(t('err_trainer_pin'));
    const current = shortTraining(info.trainings[info.current_day - 1]?.label);
    const next = shortTraining(info.trainings[info.current_day]?.label);
    if (!window.confirm(t('mtd_next_confirm').replaceAll('{current}', current).replaceAll('{next}', next))) return;
    setSubmitting(true);
    try {
      await api.publicNextTraining(token, { pin: pin.trim(), expected_current: info.current_day });
      setOpenedTraining(next);
      setPin('');
      setMode('trainee');
      setSignInStep('choice');
      load();
    } catch (err) {
      setFormError(err.message);
      load();
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
      // Before a multi-day course's last day, the trainer signs off their day instead of closing.
      if (Number(info.total_days) > 1 && info.current_day < info.total_days) {
        const day = info.current_day;
        if (!window.confirm(t('signoff_confirm').replaceAll('{day}', day).replaceAll('{next}', day + 1))) {
          setSubmitting(false);
          return;
        }
        await api.publicSignOffDay(token, day, {
          trainer_signed_name: trainerName.trim(),
          trainer_email: trainerEmail.trim(),
          trainer_phone: trainerPhone.trim(),
          pin: pin.trim(),
          signature: sigRef.current.toDataURL(),
        });
        setSignedOffDay(day);
        setPin('');
        // The next day may have a different trainer - let their details pre-fill instead.
        setTrainerName('');
        setTrainerEmail('');
        setTrainerPhone('');
        sigRef.current?.clear();
        setMode('trainee');
        load();
        return;
      }
      const isAhaSession = info?.master_training_id === AHA_ROSTER_TRAINING_ID;
      await api.publicCloseSession(token, {
        trainer_signed_name: trainerName.trim(),
        trainer_email: trainerEmail.trim(),
        trainer_phone: trainerPhone.trim(),
        pin: pin.trim(),
        signature: sigRef.current.toDataURL(),
        ...(isAhaSession ? ahaFieldsPayload(ahaFields) : {}),
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
  // Multi-day courses and Multi Training Days both check in once per part with the same QR code.
  const isMultiDay = Number(info.total_days) > 1;
  const isMultiTraining = Boolean(info.multi_training_day) && Array.isArray(info.trainings);
  const currentTraining = isMultiTraining ? info.trainings[info.current_day - 1] : null;
  const nextTraining = isMultiTraining ? info.trainings[info.current_day] : null;
  const isBoth = info.language === 'both';
  const isSpanish = info.language === 'spanish';
  const trainingLabelEs = info.training_type_label_es || info.training_type_label;
  const outlineEs = info.outline_es || info.outline;
  // Per-day outline (Keeley's request, 2026-09-22: "Day 1 has its own outline, day 2 and so
  // on") - shown instead of the blanket session outline whenever the admin set one for the
  // current day. English-only for now (no per-day machine translation), unlike the blanket
  // outline below.
  const dayOutlineText = info.day_outlines?.[info.current_day - 1];
  // Before a multi-day course's final day, the trainer tab signs off just today's day.
  const isSignoffDay = isMultiDay && !isMultiTraining && info.current_day < info.total_days;
  // Before a Multi Training Day's last training, the trainer tab opens the next one.
  const isNextTrainingStep = isMultiTraining && Boolean(nextTraining);
  const fillTraining = (key) => t(key)
    .replaceAll('{training}', shortTraining(currentTraining?.label))
    .replaceAll('{current}', shortTraining(currentTraining?.label))
    .replaceAll('{next}', shortTraining(nextTraining?.label))
    .replaceAll('{n}', info.current_day)
    .replaceAll('{total}', info.total_days);
  const fill = (key) => t(key).replaceAll('{day}', info.current_day).replaceAll('{next}', info.current_day + 1);
  const todaysTrainer = info.days?.[info.current_day - 1]?.assigned_trainer_name;

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <img src={esrMark} alt="ESR" style={{ height: 40, margin: '0 auto 10px', display: 'block' }} />
          <h2 style={{ margin: '0 0 4px' }}>
            {isMultiTraining ? t('mtd_title') : (
              <>
                {isSpanish ? trainingLabelEs : isBoth ? `${info.training_type_label}/${trainingLabelEs}` : info.training_type_label}
                {info.additional_training_labels?.map((label) => (
                  <span key={label}> + {label}</span>
                ))}
              </>
            )}
          </h2>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
            {info.client_name} · {formatDate(info.session_date)}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 2 }}>
            {t('trainer_label')} {todaysTrainer || info.trainer_name}
          </div>
        </div>

        {dayOutlineText ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 13 }}>{t('today_outline')}</strong>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{dayOutlineText}</p>
          </div>
        ) : info.outline && (
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
              {closedNow ? t(info.session_kind === 'toolbox_talk' ? 'closed_now_banner_toolbox' : 'closed_now_banner') : t('closed_already_banner')}
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
                {isNextTrainingStep ? t('mtd_trainer_tab_next') : isSignoffDay ? fill('trainer_tab_signoff') : t('trainer_tab')}
              </button>
            </div>

            {formError && <p className="error-banner">{formError}</p>}
            {signedOffDay && mode === 'trainee' && (
              <p className="success-banner">
                {t('signed_off_banner').replaceAll('{day}', signedOffDay).replaceAll('{next}', signedOffDay + 1)}
              </p>
            )}

            {justSigned && mode === 'trainee' && signInStep === 'new' && (
              <p className="success-banner">{t('signed_in_banner')}</p>
            )}
            {openedTraining && mode === 'trainee' && (
              <p className="success-banner">{t('mtd_next_banner').replaceAll('{next}', openedTraining)}</p>
            )}
            {justCheckedIn && mode === 'trainee' && (
              <p className="success-banner">{isMultiTraining ? fillTraining('mtd_checkin_success') : t('checkin_success_banner')}</p>
            )}

            {mode === 'trainer' && (
              <LiveRoster token={token} t={t} pin={pin} setPin={setPin} info={info} trainings={isMultiTraining ? info.trainings : null} />
            )}

            {mode === 'trainee' ? (
              <>
                {isMultiTraining && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        {t('mtd_now_open')}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--esr-green)' }}>{fillTraining('mtd_progress')}</span>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>
                      {currentTraining?.label}
                      {currentTraining?.duration && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-muted)' }}> · {currentTraining.duration}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                      {info.trainings.map((tr) => {
                        const isDone = tr.number < info.current_day;
                        const isActive = tr.number === info.current_day;
                        return (
                          <div key={tr.number} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                              style={{
                                width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 700, boxSizing: 'border-box', flexShrink: 0,
                                background: isDone ? 'var(--status-current-bg)' : isActive ? 'var(--esr-green)' : 'var(--color-surface)',
                                color: isDone ? 'var(--status-current-text)' : isActive ? '#fff' : 'var(--color-text-muted)',
                                border: isDone ? '1px solid var(--status-current-text)' : isActive ? '1px solid var(--esr-green)' : '1px solid var(--color-border)',
                              }}
                            >
                              {isDone ? '✓' : tr.number}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 400, color: isActive ? 'inherit' : 'var(--color-text-muted)' }}>
                              {shortTraining(tr.label)}{tr.duration ? ` · ${tr.duration}` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--status-missing-text)', background: 'var(--status-missing-bg)', borderRadius: 8, padding: '8px 10px', margin: '12px 0 0' }}>
                      {t('mtd_notice')}
                    </p>
                  </div>
                )}

                {isMultiDay && !isMultiTraining && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                        Course Progress
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--esr-green)' }}>
                        {dayProgressLabel(t, info.current_day, info.total_days)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {Array.from({ length: info.total_days }, (_, i) => i + 1).map((d) => {
                        const isDone = d < info.current_day;
                        const isActive = d === info.current_day;
                        return (
                          <div key={d} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                            <div
                              style={{
                                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 700, boxSizing: 'border-box',
                                background: isDone ? 'var(--status-current-bg)' : isActive ? 'var(--esr-green)' : 'var(--color-surface)',
                                color: isDone ? 'var(--status-current-text)' : isActive ? '#fff' : 'var(--color-text-muted)',
                                border: isDone ? '1px solid var(--status-current-text)' : isActive ? '1px solid var(--esr-green)' : '1px solid var(--color-border)',
                              }}
                            >
                              {isDone ? '✓' : d}
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                              Day {d}
                              {info.day_dates?.[d - 1] && <><br />{formatShortDate(info.day_dates[d - 1])}</>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--status-missing-text)', background: 'var(--status-missing-bg)', borderRadius: 8, padding: '8px 10px', margin: '12px 0 0' }}>
                      {t('multi_day_notice')}
                    </p>
                  </div>
                )}

                {isMultiDay && signInStep === 'choice' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {info.current_day > 1 && (
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, order: -2 }}>{t(isMultiTraining ? 'mtd_choice_hint' : 'choice_hint_later_day')}</p>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary choice-button"
                      style={{ textAlign: 'left', justifyContent: 'flex-start', gap: 14, padding: '14px 16px', height: 'auto' }}
                      onClick={() => { setJustSigned(false); setJustCheckedIn(false); setSignInStep('new'); }}
                    >
                      <span style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--status-noexp-bg)',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-noexp-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <line x1="19" y1="8" x2="19" y2="14" />
                          <line x1="16" y1="11" x2="22" y2="11" />
                        </svg>
                      </span>
                      <span>
                        <span style={{ display: 'block', fontWeight: 600 }}>{t(isMultiTraining ? 'mtd_choice_first_title' : 'choice_first_time_title')}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {t(isMultiTraining ? 'mtd_choice_first_sub' : 'choice_first_time_sub')}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary choice-button"
                      style={{
                        textAlign: 'left', justifyContent: 'flex-start', gap: 14, padding: '14px 16px', height: 'auto',
                        // From Day 2 on, most people are returning - put this option first and outline it.
                        ...(info.current_day > 1 ? { order: -1, border: '2px solid var(--status-current-text)' } : {}),
                      }}
                      onClick={() => { setJustSigned(false); setJustCheckedIn(false); setSignInStep('returning'); }}
                    >
                      <span style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--status-current-bg)',
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--status-current-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      </span>
                      <span>
                        <span style={{ display: 'block', fontWeight: 600 }}>{t(isMultiTraining ? 'mtd_choice_returning_title' : 'choice_returning_title')}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {isMultiTraining ? fillTraining('mtd_choice_returning_sub') : t('choice_returning_sub').replaceAll('{day}', info.current_day)}
                        </span>
                      </span>
                    </button>
                  </div>
                )}

                {(!isMultiDay || signInStep === 'new') && (
                  <form onSubmit={handleTraineeSubmit}>
                    {isMultiDay && (
                      <button
                        type="button"
                        className="link-button"
                        style={{ marginBottom: 10 }}
                        onClick={() => setSignInStep('choice')}
                      >
                        {t('find_name_back')}
                      </button>
                    )}
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
                )}

                {isMultiDay && signInStep === 'returning' && (
                  <ReturningAttendeeFlow
                    token={token}
                    t={t}
                    trainings={isMultiTraining ? info.trainings : null}
                    currentDay={info.current_day}
                    onBack={() => setSignInStep('choice')}
                    onDone={() => {
                      setOpenedTraining('');
                      setJustCheckedIn(true);
                      setSignInStep('choice');
                      load();
                    }}
                  />
                )}
              </>
            ) : isNextTrainingStep ? (
              <form onSubmit={handleNextTraining}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{fillTraining('mtd_next_note')}</p>
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
                <button className="btn btn-accent" type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? t('starting_ellipsis') : fillTraining('mtd_next_button')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleTrainerClose}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{isSignoffDay ? fill('signoff_note') : info.session_kind === 'toolbox_talk' ? t('close_note_toolbox') : t('close_note')}</p>
                {/* Any listed trainer can close out (Keeley's call, 2026-10-01). The saved email and
                    phone belong to the lead trainer, so picking someone else clears them. */}
                {(info.trainer_names || []).length > 1 && (
                  <div className="field">
                    <label>{t('who_closing')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {info.trainer_names.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className={`btn btn-sm ${trainerName === name ? '' : 'btn-secondary'}`}
                          onClick={() => {
                            setTrainerName(name);
                            const isLead = name === info.trainer_name;
                            setTrainerEmail(isLead ? info.trainer_email || '' : '');
                            setTrainerPhone(isLead ? info.trainer_phone || '' : '');
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                {info.master_training_id === AHA_ROSTER_TRAINING_ID && !isSignoffDay && (
                  <AhaRosterFields value={ahaFields} onChange={setAhaFields} />
                )}
                <div className="field">
                  <label>{t('trainer_signature')}</label>
                  <SignaturePad ref={sigRef} />
                </div>
                <button className={isSignoffDay ? 'btn btn-accent' : 'btn btn-danger'} type="submit" disabled={submitting} style={{ width: '100%' }}>
                  {isSignoffDay
                    ? (submitting ? t('signing_off_ellipsis') : fill('signoff_button'))
                    : (submitting ? t('closing_ellipsis') : `${t('close_session_label')} (${info.attendee_count} ${t('signed_in_label')})`)}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
