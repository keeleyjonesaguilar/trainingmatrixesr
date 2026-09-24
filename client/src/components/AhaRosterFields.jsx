// The AHA Heartsaver Course Roster section (Keeley's request, 2026-09-21) - shown for First
// Aid/CPR/AED sessions on the trainer's close-out form (PublicSignIn.jsx) and on the post-close
// edit page (PublicSessionEdit.jsx), so both fill the official roster the same way. The whole
// section is one controlled `value` object; ahaFieldsPayload() turns it into the hs_* request
// fields the server stores (server/lib/sessionCloseOut.js).
import { AHA_COURSE_OPTIONS, AHA_COURSE_GROUPS } from '../lib/ahaCourseOptions';
import { AHA_OPTIONAL_TOPICS } from '../lib/ahaOptionalTopics';

// The one training this section applies to - matches server/lib/sessionCloseOut.js.
export const AHA_ROSTER_TRAINING_ID = 'TRN-020';

const TEXT_FIELDS = [
  { key: 'hs_training_center', label: 'Training Center' },
  { key: 'hs_training_center_id', label: 'Training Center ID#' },
  { key: 'hs_training_site_name', label: 'Training Site Name (if applicable)' },
  { key: 'hs_address', label: 'Address' },
  { key: 'hs_city_state_zip', label: 'City, State ZIP' },
  { key: 'hs_course_start', label: 'Course Start Date/Time', type: 'datetime-local' },
  { key: 'hs_course_end', label: 'Course End Date/Time', type: 'datetime-local' },
  { key: 'hs_total_hours', label: 'Total Hours of Instruction' },
  { key: 'hs_no_of_cards_issued', label: 'No. of Cards Issued' },
  { key: 'hs_student_manikin_ratio', label: 'Student-Manikin Ratio' },
  { key: 'hs_issue_date_of_cards', label: 'Issue Date of Cards', type: 'date' },
  { key: 'hs_card_expiration_date', label: 'Card Expiration Date', type: 'date' },
];

const BLANK_INSTRUCTOR = { name_id: '', card_exp_date: '' };

export const EMPTY_AHA_FIELDS = {
  ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, ''])),
  hs_course_options: [],
  hs_optional_topics: [],
  has_additional_instructors: false,
  additional_instructors: [BLANK_INSTRUCTOR],
  // Saved values a date/time picker can't display (e.g. typed in an older format) - kept and
  // sent back unchanged unless that field is edited, so opening the edit page never erases them.
  saved_raw: {},
};

// Renders an <input type="datetime-local"> value ("2026-09-21T08:00") as the short "09/21/26
// 8:00 AM" style the printed AHA form expects - short-dated (MM/DD/YY) so the whole thing still
// fits on the form's one-line "Course Start/End Date/Time" field alongside the time. Deliberately
// does its own string parsing instead of round-tripping through `new Date(...)` - a datetime-
// local value is just wall-clock numbers with no timezone attached, and this app's whole
// convention is that a time typed in means Eastern, the business's own timezone, regardless of
// what timezone the trainer's phone/laptop happens to be set to (see client/src/lib/dates.js) -
// building a real Date object here would silently reinterpret those numbers through the device's
// local offset instead of leaving them exactly as entered.
function formatDateTimeLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return '';
  const [, year, month, day, hour24, minute] = match;
  const hour24Num = Number(hour24);
  const period = hour24Num >= 12 ? 'PM' : 'AM';
  const hour12 = hour24Num % 12 === 0 ? 12 : hour24Num % 12;
  return `${month}/${day}/${year.slice(2)} ${hour12}:${minute} ${period}`;
}

// The reverse, for the edit page: "09/21/26 8:00 AM" -> "2026-09-21T08:00".
function parseSavedDateTime(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/.exec(value || '');
  if (!match) return '';
  const [, month, day, year, hour12, minute, period] = match;
  const hour24 = (Number(hour12) % 12) + (period === 'PM' ? 12 : 0);
  return `20${year}-${month}-${day}T${String(hour24).padStart(2, '0')}:${minute}`;
}

// Saved hs_* values (as GET /api/session-edit/:token/unlock returns them) -> this form's value.
export function ahaFieldsFromSaved(aha) {
  const value = { ...EMPTY_AHA_FIELDS, saved_raw: {} };
  for (const { key, type } of TEXT_FIELDS) {
    const saved = aha?.[key] || '';
    let shown = saved;
    if (type === 'datetime-local') shown = parseSavedDateTime(saved);
    if (type === 'date') shown = /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : '';
    value[key] = shown;
    if (saved && !shown) value.saved_raw[key] = saved;
  }
  value.hs_course_options = aha?.hs_course_options || [];
  value.hs_optional_topics = aha?.hs_optional_topics || [];
  const instructors = aha?.hs_additional_instructors || [];
  value.has_additional_instructors = instructors.length > 0;
  value.additional_instructors = instructors.length ? instructors : [BLANK_INSTRUCTOR];
  return value;
}

export function ahaFieldsPayload(value) {
  const payload = {};
  for (const { key, type } of TEXT_FIELDS) {
    const entered = type === 'datetime-local' ? formatDateTimeLocal(value[key]) : String(value[key] || '').trim();
    payload[key] = entered || value.saved_raw?.[key] || '';
  }
  payload.hs_course_options = value.hs_course_options;
  payload.hs_optional_topics = value.hs_optional_topics;
  payload.hs_additional_instructors = value.has_additional_instructors
    ? value.additional_instructors.filter((row) => row.name_id.trim() || row.card_exp_date.trim()).slice(0, 8)
    : [];
  return payload;
}

export default function AhaRosterFields({ value, onChange }) {
  const set = (changes) => onChange({ ...value, ...changes });

  const setText = (key, text) => {
    const savedRaw = { ...value.saved_raw };
    delete savedRaw[key]; // edited - no longer keep the old unreadable value
    set({ [key]: text, saved_raw: savedRaw });
  };

  const toggleCourseOption = (key) => {
    const current = value.hs_course_options;
    if (current.includes(key)) {
      // Unchecking a top-level course also clears its own sub-options - they're meaningless
      // without the course they belong to.
      const subKeys = AHA_COURSE_OPTIONS.filter((o) => o.group === key).map((o) => o.key);
      set({ hs_course_options: current.filter((k) => k !== key && !subKeys.includes(k)) });
    } else {
      set({ hs_course_options: [...current, key] });
    }
  };

  const toggleTopic = (key) => {
    const current = value.hs_optional_topics;
    set({ hs_optional_topics: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] });
  };

  const instructors = value.additional_instructors;
  const updateInstructor = (index, field, text) => {
    set({ additional_instructors: instructors.map((row, i) => (i === index ? { ...row, [field]: text } : row)) });
  };

  return (
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
                checked={value.hs_course_options.includes(groupOpt.key)}
                onChange={() => toggleCourseOption(groupOpt.key)}
              />
              {groupOpt.label}
            </label>
            {value.hs_course_options.includes(groupOpt.key) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginLeft: 24, marginTop: 4 }}>
                {AHA_COURSE_OPTIONS.filter((o) => o.group === groupOpt.key).map((sub) => (
                  <label key={sub.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={value.hs_course_options.includes(sub.key)}
                      onChange={() => toggleCourseOption(sub.key)}
                    />
                    {sub.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {TEXT_FIELDS.map(({ key, label, type }) => (
        <div className="field" key={key}>
          <label>{label}</label>
          <input type={type || 'text'} value={value[key]} onChange={(e) => setText(key, e.target.value)} />
          {value.saved_raw?.[key] && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
              Currently on file: {value.saved_raw[key]}
            </p>
          )}
        </div>
      ))}

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={value.has_additional_instructors}
            onChange={(e) => set({ has_additional_instructors: e.target.checked })}
          />
          Any additional/assisting instructors?
        </label>
      </div>
      {value.has_additional_instructors && (
        <div style={{ marginBottom: 12 }}>
          {instructors.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Name and Instructor ID#</label>
                <input value={row.name_id} onChange={(e) => updateInstructor(i, 'name_id', e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Card Exp. Date</label>
                <input value={row.card_exp_date} onChange={(e) => updateInstructor(i, 'card_exp_date', e.target.value)} />
              </div>
              {instructors.length > 1 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => set({ additional_instructors: instructors.filter((_, idx) => idx !== i) })}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {instructors.length < 8 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => set({ additional_instructors: [...instructors, BLANK_INSTRUCTOR] })}
            >
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
                <input type="checkbox" checked={value.hs_optional_topics.includes(topic.key)} onChange={() => toggleTopic(topic.key)} />
                {topic.label}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
