// Maps the AHA Heartsaver Course Roster's 25 "Course Information" checkboxes (page 1) to the
// literal PDF field names in server/assets/aha-heartsaver-course-roster.pdf - reverse-engineered
// from each checkbox's x/y position against the form's own visible layout, since the PDF names
// them generically ("Check Box 101"..."Check Box 125") with no indication of what they mean.
// Deliberately excludes "Check Box 301"-"Check Box 328" (page 3's Optional Topics Checklist) and
// the 8-row Assisting Instructor grid - both out of scope for now (Keeley's call, 2026-09-21).
//
// Each option belongs to one `group` (a top-level course, itself also a checkbox) except the
// groups' own top-level entries, which have group: null. The close-out form only shows a group's
// sub-options once its own top-level box is checked.
const AHA_COURSE_OPTIONS = [
  { key: 'heartsaver_cpr_aed', field: 'Check Box 101', label: 'Heartsaver CPR AED', group: null },
  { key: 'cpr_aed_child_cpr_aed', field: 'Check Box 102', label: 'Child CPR AED', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_infant_cpr', field: 'Check Box 103', label: 'Infant CPR', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_exam', field: 'Check Box 104', label: 'Exam', group: 'heartsaver_cpr_aed' },

  { key: 'heartsaver_first_aid_cpr_aed', field: 'Check Box 105', label: 'Heartsaver First Aid CPR AED', group: null },
  { key: 'fa_cpr_aed_child_cpr_aed', field: 'Check Box 106', label: 'Child CPR AED', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_infant_cpr', field: 'Check Box 107', label: 'Infant CPR', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_exam', field: 'Check Box 108', label: 'Exam', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_heartsaver_total', field: 'Check Box 109', label: 'Heartsaver Total', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_office', field: 'Check Box 110', label: 'Office', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_educator', field: 'Check Box 111', label: 'Educator', group: 'heartsaver_first_aid_cpr_aed' },

  { key: 'heartsaver_first_aid', field: 'Check Box 112', label: 'Heartsaver First Aid', group: null },
  { key: 'fa_exam', field: 'Check Box 113', label: 'Exam', group: 'heartsaver_first_aid' },

  { key: 'heartsaver_pediatric_first_aid_cpr_aed', field: 'Check Box 114', label: 'Heartsaver Pediatric First Aid CPR AED', group: null },
  { key: 'ped_adult_cpr', field: 'Check Box 115', label: 'Adult CPR', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_exam', field: 'Check Box 116', label: 'Exam', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_heartsaver_pediatric_total', field: 'Check Box 117', label: 'Heartsaver Pediatric Total', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_babysitter', field: 'Check Box 118', label: 'Babysitter', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_water_safety', field: 'Check Box 119', label: 'Water Safety', group: 'heartsaver_pediatric_first_aid_cpr_aed' },

  { key: 'heartsaver_k12', field: 'Check Box 120', label: 'Heartsaver for K-12 Schools', group: null },
  { key: 'k12_child_cpr_aed', field: 'Check Box 121', label: 'Child CPR AED', group: 'heartsaver_k12' },
  { key: 'k12_infant_cpr', field: 'Check Box 122', label: 'Infant CPR', group: 'heartsaver_k12' },
  { key: 'k12_first_aid', field: 'Check Box 123', label: 'First Aid', group: 'heartsaver_k12' },
  { key: 'k12_exam', field: 'Check Box 124', label: 'Exam', group: 'heartsaver_k12' },

  { key: 'heartsaver_instructor', field: 'Check Box 125', label: 'Heartsaver Instructor', group: null },
];

const AHA_COURSE_GROUPS = AHA_COURSE_OPTIONS.filter((o) => o.group === null);

module.exports = { AHA_COURSE_OPTIONS, AHA_COURSE_GROUPS };
