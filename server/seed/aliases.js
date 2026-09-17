// Terminology mapping dictionary (spec section 5): client spreadsheet wording -> Training ID.
// This is the auto-match layer for CSV import. Anything not found here (or in master_trainings
// exact names) is queued in import_column_map as "needs_review" rather than guessed at -
// per spec section 15, similar-sounding trainings are never silently collapsed together.
//
// Stored lowercase/trimmed; matching normalizes the same way plus strips punctuation.
//
// Replaced 2026-09-01 alongside the master catalog rebuild - every alias below was pulled
// directly from the "Original Name(s) Merged In" column of the certification-by-certification
// review (Certification_Master_List_Detailed.xlsx), not guessed. Aliases an admin resolves
// manually through the Import Data review screen are added to this same table at runtime and
// are unaffected by this file - this is just the seeded starting set.

const TRAINING_ALIASES = [
  ["Carbon Moxide Exposure", "TRN-009"],
  ["Crane Safety", "TRN-017"],
  ["Ergomics", "TRN-026"],
  ["Fall Protection/Falling Objects/PFAS Inspection", "TRN-029"],
  ["Fire Extinguisher Training", "TRN-031"],
  ["Fire Protection", "TRN-032"],
  ["Fire Safety, Protection and Prevention", "TRN-032"],
  ["First Aid / CPR / AED", "TRN-034"],
  ["First Aid/CPR", "TRN-034"],
  ["First Aid/CPR/AED (American Heart Association)", "TRN-035"],
  ["ARC First Aid/CPR/AED Certificate", "TRN-036"],
  ["First Aid/CPR/AED Instructor", "TRN-037"],
  ["Forklift Operator", "TRN-040"],
  ["PIT Operator", "TRN-040"],
  ["Forklift Operator Trainer", "TRN-041"],
  ["Powered Industrial Trucks - Train the Trainer", "TRN-041"],
  ["Gantry Crane", "TRN-042"],
  ["Gantry Crane Train the Trainer", "TRN-043"],
  ["Hand and Power Tools", "TRN-044"],
  ["Heat Stress", "TRN-050"],
  ["Ladder Awareness", "TRN-059"],
  ["Ladder Safety Awareness", "TRN-059"],
  ["Ladder Safety Monthly Safety Meeting", "TRN-060"],
  ["Proper Lifting Techniques", "TRN-063"],
  ["Lull Operator Trainer", "TRN-066"],
  ["MEWP: Train the Trainer", "TRN-072"],
  ["MEWP Operator", "TRN-073"],
  ["MEWP: Boom Lift", "TRN-074"],
  ["Mobile Elevated Work Platform (MEWP) - Boom Lift", "TRN-074"],
  ["Mini Excavator - Train the Trainer", "TRN-075"],
  ["N95 Voluntary Respiratory Use Form", "TRN-079"],
  ["New Hire Orientation", "TRN-082"],
  ["OSHA 10 (Construction)", "TRN-085"],
  ["OSHA 10 (General Industry)", "TRN-086"],
  ["OSHA 10-Hour", "TRN-087"],
  ["OSHA 10", "TRN-087"],
  ["OSHA10", "TRN-087"],
  ["OSHA 30 (Construction)", "TRN-088"],
  ["OSHA 30 (General Industry)", "TRN-089"],
  ["OSHA 30-Hour", "TRN-090"],
  ["OSHA 30", "TRN-090"],
  ["OSHA30", "TRN-090"],
  ["OSHA 500", "TRN-091"],
  ["OSHA 501", "TRN-092"],
  ["OSHA 502", "TRN-093"],
  ["OSHA 503", "TRN-094"],
  ["OSHA 510", "TRN-095"],
  ["OSHA 511", "TRN-096"],
  ["OSHA 7500", "TRN-097"],
  ["OSHA 7505", "TRN-098"],
  ["OSHA Recordkeeping", "TRN-099"],
  ["PPE - Personal Protective Equipment", "TRN-101"],
  ["Power Industrial Truck (Class I, II, III, IV, V, VI & VII) Train-the Trainer Course EPRO Safety Solutions", "TRN-102"],
  ["Signal Person", "TRN-105"],
  ["3M Medical Clearance for Respiratory Use", "TRN-107"],
  ["Repiratory Protection", "TRN-108"],
  ["Rigging", "TRN-109"],
  ["Scaffolding", "TRN-115"],
  ["Scissor Lift", "TRN-116"],
  ["Mobile Elevated Work Platform: Scissor Lift", "TRN-116"],
  ["Silica", "TRN-117"],
  ["Skid Steer Train the Trainer", "TRN-119"],
  ["Toolbox Talk - Mandatory vs. Voluntary Usage", "TRN-129"],
  ["Trenching and Excavations", "TRN-130"],
  ["Respirator Fit Testing", "TRN-140"],
  ["Respiratory Fit", "TRN-140"],
  ["AC Respiratory Fit Test Record", "TRN-140"],
];

module.exports = TRAINING_ALIASES;
