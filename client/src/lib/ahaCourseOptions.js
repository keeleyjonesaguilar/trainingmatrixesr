// Client-side mirror of server/lib/ahaCourseOptions.js (kept in sync manually - it's static
// data reverse-engineered once from the AHA PDF's own checkbox layout, not something either side
// computes) - lets the trainer close-out form render the same 25 Course Information checkboxes
// from the official AHA Heartsaver Course Roster without importing server code into the client.
export const AHA_COURSE_OPTIONS = [
  { key: 'heartsaver_cpr_aed', label: 'Heartsaver CPR AED', group: null },
  { key: 'cpr_aed_child_cpr_aed', label: 'Child CPR AED', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_infant_cpr', label: 'Infant CPR', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_exam', label: 'Exam', group: 'heartsaver_cpr_aed' },

  { key: 'heartsaver_first_aid_cpr_aed', label: 'Heartsaver First Aid CPR AED', group: null },
  { key: 'fa_cpr_aed_child_cpr_aed', label: 'Child CPR AED', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_infant_cpr', label: 'Infant CPR', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_exam', label: 'Exam', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_heartsaver_total', label: 'Heartsaver Total', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_office', label: 'Office', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_educator', label: 'Educator', group: 'heartsaver_first_aid_cpr_aed' },

  { key: 'heartsaver_first_aid', label: 'Heartsaver First Aid', group: null },
  { key: 'fa_exam', label: 'Exam', group: 'heartsaver_first_aid' },

  { key: 'heartsaver_pediatric_first_aid_cpr_aed', label: 'Heartsaver Pediatric First Aid CPR AED', group: null },
  { key: 'ped_adult_cpr', label: 'Adult CPR', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_exam', label: 'Exam', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_heartsaver_pediatric_total', label: 'Heartsaver Pediatric Total', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_babysitter', label: 'Babysitter', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_water_safety', label: 'Water Safety', group: 'heartsaver_pediatric_first_aid_cpr_aed' },

  { key: 'heartsaver_k12', label: 'Heartsaver for K-12 Schools', group: null },
  { key: 'k12_child_cpr_aed', label: 'Child CPR AED', group: 'heartsaver_k12' },
  { key: 'k12_infant_cpr', label: 'Infant CPR', group: 'heartsaver_k12' },
  { key: 'k12_first_aid', label: 'First Aid', group: 'heartsaver_k12' },
  { key: 'k12_exam', label: 'Exam', group: 'heartsaver_k12' },

  { key: 'heartsaver_instructor', label: 'Heartsaver Instructor', group: null },
];

export const AHA_COURSE_GROUPS = AHA_COURSE_OPTIONS.filter((o) => o.group === null);
