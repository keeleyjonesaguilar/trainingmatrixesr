// Client-side mirror of server/lib/ahaOptionalTopics.js (kept in sync manually - static data
// reverse-engineered once from the AHA PDF's own checkbox layout) - lets the trainer close-out
// form render the page-3 "Optional Topics Checklist" without importing server code.
export const AHA_OPTIONAL_TOPICS = [
  { key: 'overdose_adult', label: 'How to Help an Adult With a Drug Overdose Emergency (Adult)', section: 'CPR AED' },
  { key: 'overdose_pediatric', label: 'Drug Overdose (Pediatric)', section: 'CPR AED' },
  { key: 'water_safety_drowning', label: 'Water Safety/Drowning', section: 'CPR AED' },

  { key: 'breathing_problems', label: 'Breathing Problems (Asthma) (Adult)', section: 'First Aid Medical Emergencies' },
  { key: 'choking', label: 'Choking in an Adult, a Child, or an Infant (Adult)', section: 'First Aid Medical Emergencies' },
  { key: 'fainting', label: 'Fainting', section: 'First Aid Medical Emergencies' },
  { key: 'diabetes_low_blood_sugar', label: 'Diabetes and Low Blood Sugar', section: 'First Aid Medical Emergencies' },
  { key: 'seizure', label: 'Seizure', section: 'First Aid Medical Emergencies' },

  { key: 'shock', label: 'Shock', section: 'First Aid Injury Emergencies' },
  { key: 'bleeding_nose', label: 'Bleeding From the Nose', section: 'First Aid Injury Emergencies' },
  { key: 'bleeding_mouth', label: 'Bleeding From the Mouth', section: 'First Aid Injury Emergencies' },
  { key: 'tooth_injuries', label: 'Tooth Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'eye_injuries', label: 'Eye Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'penetrating_puncturing_injuries', label: 'Penetrating and Puncturing Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'amputation', label: 'Amputation', section: 'First Aid Injury Emergencies' },
  { key: 'internal_bleeding', label: 'Internal Bleeding', section: 'First Aid Injury Emergencies' },
  { key: 'concussions', label: 'Concussions', section: 'First Aid Injury Emergencies' },
  { key: 'head_neck_spine_injuries', label: 'Head, Neck, and Spine Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'broken_bones_sprains', label: 'Broken Bones and Sprains', section: 'First Aid Injury Emergencies' },
  { key: 'splinting', label: 'Splinting', section: 'First Aid Injury Emergencies' },
  { key: 'burns_electrical_injuries', label: 'Burns and Electrical Injuries', section: 'First Aid Injury Emergencies' },
  { key: 'bites_stings', label: 'Bites and Stings', section: 'First Aid Injury Emergencies' },
  { key: 'heat_related_emergencies', label: 'Heat-Related Emergencies', section: 'First Aid Injury Emergencies' },
  { key: 'cold_related_emergencies', label: 'Cold-Related Emergencies', section: 'First Aid Injury Emergencies' },
  { key: 'poison_emergencies', label: 'Poison Emergencies', section: 'First Aid Injury Emergencies' },

  { key: 'risks_smoking_vaping', label: 'Risks of Smoking and Vaping', section: 'First Aid Prevention' },
  { key: 'benefits_healthy_lifestyle', label: 'Benefits of a Healthy Lifestyle', section: 'First Aid Prevention' },
  { key: 'preventing_illness_injury', label: 'Preventing Illness and Injury', section: 'First Aid Prevention' },
];
