// Maps the AHA Heartsaver Course Roster's 21 "Course Information" checkboxes (page 1) to the
// literal PDF field names in server/assets/aha-heartsaver-course-roster.pdf - matched from each
// checkbox's position against the form's own printed labels, since the PDF names them
// generically ("Check Box 36", "Check Box 44"...). Form version KJ-1958 HS 10/25 (Keeley's update,
// 2026-09-29) - it dropped the Office/Educator/Pediatric Total/Babysitter/Water Safety paths
// (and with them the Optional Topics page) and added Heartsaver Basic. Keys are kept from the
// earlier form wherever the option still exists, so sessions already closed read the same.
//
// Each option belongs to one `group` (a top-level course, itself also a checkbox) except the
// groups' own top-level entries, which have group: null. The close-out form only shows a group's
// sub-options once its own top-level box is checked.
const AHA_COURSE_OPTIONS = [
  { key: 'heartsaver_cpr_aed', field: 'Check Box 36', label: 'Heartsaver CPR AED', group: null },
  { key: 'cpr_aed_child_cpr_aed', field: 'Check Box 49', label: 'Child CPR AED', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_infant_cpr', field: 'Check Box 50', label: 'Infant CPR AED', group: 'heartsaver_cpr_aed' },
  { key: 'cpr_aed_exam', field: 'Check Box 51', label: 'Exam', group: 'heartsaver_cpr_aed' },

  { key: 'heartsaver_first_aid_cpr_aed', field: 'Check Box 44', label: 'Heartsaver First Aid CPR AED', group: null },
  { key: 'fa_cpr_aed_heartsaver_total', field: 'Check Box 52', label: 'Heartsaver Total', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_heartsaver_basic', field: 'Check Box 56', label: 'Heartsaver Basic', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_child_cpr_aed', field: 'Check Box 55', label: 'Child CPR AED', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_infant_cpr', field: 'Check Box 54', label: 'Infant CPR AED', group: 'heartsaver_first_aid_cpr_aed' },
  { key: 'fa_cpr_aed_exam', field: 'Check Box 53', label: 'Exam', group: 'heartsaver_first_aid_cpr_aed' },

  { key: 'heartsaver_first_aid', field: 'Check Box 45', label: 'Heartsaver First Aid', group: null },
  { key: 'fa_exam', field: 'Check Box 57', label: 'Exam', group: 'heartsaver_first_aid' },

  { key: 'heartsaver_pediatric_first_aid_cpr_aed', field: 'Check Box 46', label: 'Heartsaver Pediatric First Aid CPR AED', group: null },
  { key: 'ped_adult_cpr', field: 'Check Box 62', label: 'Adult CPR', group: 'heartsaver_pediatric_first_aid_cpr_aed' },
  { key: 'ped_exam', field: 'Check Box 63', label: 'Exam', group: 'heartsaver_pediatric_first_aid_cpr_aed' },

  { key: 'heartsaver_k12', field: 'Check Box 47', label: 'Heartsaver for K-12 Schools', group: null },
  { key: 'k12_child_cpr_aed', field: 'Check Box 58', label: 'Child CPR AED', group: 'heartsaver_k12' },
  { key: 'k12_infant_cpr', field: 'Check Box 59', label: 'Infant CPR AED', group: 'heartsaver_k12' },
  { key: 'k12_first_aid', field: 'Check Box 60', label: 'First Aid', group: 'heartsaver_k12' },
  { key: 'k12_exam', field: 'Check Box 61', label: 'Exam', group: 'heartsaver_k12' },

  { key: 'heartsaver_instructor', field: 'Check Box 48', label: 'Heartsaver Instructor', group: null },
];

const AHA_COURSE_GROUPS = AHA_COURSE_OPTIONS.filter((o) => o.group === null);

module.exports = { AHA_COURSE_OPTIONS, AHA_COURSE_GROUPS };
