// Maps the AHA Heartsaver Course Roster's page-3 "Optional Topics Checklist" (28 checkboxes,
// "Check Box 301" through "Check Box 328") to their literal PDF field names - same reverse-
// engineering approach as server/lib/ahaCourseOptions.js's page-1 mapping. This is a flat,
// per-session checklist (the form itself treats it as "which optional topics did this class
// cover", not per-attendee), grouped into `section` only for the close-out form's display.
const AHA_OPTIONAL_TOPICS = [
  { key: 'overdose_adult', field: 'Check Box 301', label: 'How to Help an Adult With a Drug Overdose Emergency (Adult)', section: 'CPR AED' },
  { key: 'overdose_pediatric', field: 'Check Box 302', label: 'Drug Overdose (Pediatric)', section: 'CPR AED' },
  { key: 'water_safety_drowning', field: 'Check Box 303', label: 'Water Safety/Drowning', section: 'CPR AED' },

  { key: 'breathing_problems', field: 'Check Box 304', label: 'Breathing Problems (Asthma) (Adult)', section: 'First Aid Medical Emergencies' },
  { key: 'choking', field: 'Check Box 305', label: 'Choking in an Adult, a Child, or an Infant (Adult)', section: 'First Aid Medical Emergencies' },
  { key: 'fainting', field: 'Check Box 306', label: 'Fainting', section: 'First Aid Medical Emergencies' },
  { key: 'diabetes_low_blood_sugar', field: 'Check Box 307', label: 'Diabetes and Low Blood Sugar', section: 'First Aid Medical Emergencies' },
  { key: 'seizure', field: 'Check Box 308', label: 'Seizure', section: 'First Aid Medical Emergencies' },

  { key: 'shock', field: 'Check Box 309', label: 'Shock', section: 'First Aid Injury Emergencies' },
  { key: 'bleeding_nose', field: 'Check Box 310', label: 'Bleeding From the Nose', section: 'First Aid Injury Emergencies' },
  { key: 'bleeding_mouth', field: 'Check Box 311', label: 'Bleeding From the Mouth', section: 'First Aid Injury Emergencies' },
  { key: 'tooth_injuries', field: 'Check Box 312', label: 'Tooth Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'eye_injuries', field: 'Check Box 313', label: 'Eye Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'penetrating_puncturing_injuries', field: 'Check Box 314', label: 'Penetrating and Puncturing Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'amputation', field: 'Check Box 315', label: 'Amputation', section: 'First Aid Injury Emergencies' },
  { key: 'internal_bleeding', field: 'Check Box 316', label: 'Internal Bleeding', section: 'First Aid Injury Emergencies' },
  { key: 'concussions', field: 'Check Box 317', label: 'Concussions', section: 'First Aid Injury Emergencies' },
  { key: 'head_neck_spine_injuries', field: 'Check Box 318', label: 'Head, Neck, and Spine Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'broken_bones_sprains', field: 'Check Box 319', label: 'Broken Bones and Sprains', section: 'First Aid Injury Emergencies' },
  { key: 'splinting', field: 'Check Box 320', label: 'Splinting', section: 'First Aid Injury Emergencies' },
  { key: 'burns_electrical_injuries', field: 'Check Box 321', label: 'Burns and Electrical Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'bites_stings', field: 'Check Box 322', label: 'Bites and Stings', section: 'First Aid Injury Emergencies' },
  { key: 'heat_related_emergencies', field: 'Check Box 323', label: 'Heat-Related Emergencies', section: 'First Aid Injury Emergencies' },
  { key: 'cold_related_emergencies', field: 'Check Box 324', label: 'Cold-Related Emergencies', section: 'First Aid Injury Emergencies' },
  { key: 'poison_emergencies', field: 'Check Box 325', label: 'Poison Emergencies', section: 'First Aid Injury Emergencies' },

  { key: 'risks_smoking_vaping', field: 'Check Box 326', label: 'Risks of Smoking and Vaping', section: 'First Aid Prevention' },
  { key: 'benefits_healthy_lifestyle', field: 'Check Box 327', label: 'Benefits of a Healthy Lifestyle', section: 'First Aid Prevention' },
  { key: 'preventing_illness_injury', field: 'Check Box 328', label: 'Preventing Illness and Injury', section: 'First Aid Prevention' },
];

module.exports = { AHA_OPTIONAL_TOPICS };
