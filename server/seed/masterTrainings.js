// Master Training Catalog - source of truth. Do not create per-client variants of this list;
// client terminology differences are handled via training_aliases + client_training_requirements.
//
// NOTE on TRN-012: the build spec's categorized expiration table skipped TRN-012 (First Aid /
// CPR / AED) - it jumped from TRN-011 straight to TRN-013. The earlier ChatGPT spec doc (which
// this build is refining) gives TRN-012 as Medical/Emergency - Training - 2 Years, and explicitly
// uses it as the example for client-specific expiration overrides ("Master default 2 Years,
// Client A override 3 Years"). That value is used here rather than guessing; flagged for
// Keeley to confirm.

const MASTER_TRAININGS = [
  ['TRN-001', 'OSHA 10-Hour', 'OSHA', 'Training', 'None'],
  ['TRN-002', 'OSHA 30-Hour', 'OSHA', 'Training', 'None'],
  ['TRN-003', 'OSHA 510', 'OSHA', 'Training', 'None'],
  ['TRN-004', 'OSHA 500', 'OSHA', 'Training', 'None'],
  ['TRN-005', 'Hazard Communication (HAZCOM)', 'Safety', 'Training', '1 Year'],
  ['TRN-006', 'Fall Protection', 'Safety', 'Training', '1 Year'],
  ['TRN-007', 'Ladder Safety', 'Safety', 'Training', '1 Year'],
  ['TRN-008', 'Trenching & Excavation', 'Safety', 'Training', '1 Year'],
  ['TRN-009', 'Confined Space', 'Safety', 'Training', '1 Year'],
  ['TRN-010', 'Lockout/Tagout (LOTO)', 'Safety', 'Training', '1 Year'],
  ['TRN-011', 'Focus Five', 'Safety', 'Training', '1 Year'],
  ['TRN-012', 'First Aid / CPR / AED', 'Medical/Emergency', 'Training', '2 Years'],
  ['TRN-013', 'Bloodborne Pathogens', 'Medical/Emergency', 'Training', 'None'],
  ['TRN-014', 'Respiratory Protection', 'Safety', 'Training', 'None'],
  ['TRN-015', 'Respirator Fit Testing', 'Safety', 'Fit Test', '1 Year'],
  ['TRN-016', 'Personal Protective Equipment (PPE)', 'Safety', 'Training', 'None'],
  ['TRN-017', 'Fire Safety/Prevention', 'Safety', 'Training', 'None'],
  ['TRN-018', 'Fire Extinguisher', 'Safety', 'Training', 'None'],
  ['TRN-019', 'Electrical Safety', 'Safety', 'Training', 'None'],
  ['TRN-020', 'Electrical Hazard Awareness', 'Safety', 'Training', 'None'],
  ['TRN-021', 'Heat Illness Prevention', 'Safety', 'Training', 'None'],
  ['TRN-022', 'Silica Awareness', 'Safety', 'Training', 'None'],
  ['TRN-023', 'Hand & Power Tools', 'Safety', 'Training', 'None'],
  ['TRN-024', 'Machine Guarding', 'Safety', 'Training', 'None'],
  ['TRN-025', 'Stored Energy', 'Safety', 'Training', '3 Years'],
  ['TRN-026', 'Lifting Safety', 'Safety', 'Training', 'None'],
  ['TRN-027', 'Scaffold User', 'Equipment/Safety', 'Training', '3 Years'],
  ['TRN-028', 'Mobile Scaffold', 'Equipment/Safety', 'Training', 'None'],
  ['TRN-029', 'Suspended Scaffold', 'Equipment/Safety', 'Training', 'None'],
  ['TRN-030', 'Forklift Operator', 'Equipment', 'Certification', '3 Years'],
  ['TRN-031', 'Counterbalance Forklift', 'Equipment', 'Certification', 'None'],
  ['TRN-032', 'Rough Terrain Forklift', 'Equipment', 'Certification', 'None'],
  ['TRN-033', 'MEWP Operator', 'Equipment', 'Certification', '3 Years'],
  ['TRN-034', 'Boom Lift', 'Equipment', 'Certification', 'None'],
  ['TRN-035', 'Scissor Lift', 'Equipment', 'Certification', 'None'],
  ['TRN-036', 'Mini Excavator Operator', 'Equipment', 'Certification', 'None'],
  ['TRN-037', 'Excavator Operator', 'Equipment', 'Certification', 'None'],
  ['TRN-038', 'Skid Steer Operator', 'Equipment', 'Certification', '3 Years'],
  ['TRN-039', 'Dump Truck', 'Equipment', 'Training', 'None'],
  ['TRN-040', 'Crane Safety', 'Equipment', 'Training', '3 Years'],
  ['TRN-041', 'Qualified Rigger', 'Rigging', 'Certification', '3 Years'],
  ['TRN-042', 'Qualified Signalperson', 'Rigging', 'Certification', 'None'],
  ['TRN-043', 'Utility Strike Avoidance Planning (USAP)', 'Safety', 'Training', '3 Years'],
  ['TRN-044', 'Demolition/Rework', 'Safety', 'Training', '3 Years'],
  ['TRN-045', 'Welding & Hot Work', 'Safety', 'Training', 'None'],
  ['TRN-046', 'Refueling Safety', 'Safety', 'Training', 'None'],
  ['TRN-047', 'Defensive Driving', 'Driver/Fleet', 'Training', 'None'],
  ['TRN-048', "Commercial Driver's License (CDL)", 'Driver/Fleet', 'License', 'None'],
  ['TRN-049', 'Ergonomics', 'Safety', 'Training', 'None'],
  ['TRN-050', 'Emergency Action Plan (EAP)', 'Emergency', 'Training', 'None'],
  ['TRN-051', 'New Hire Orientation (NHO)', 'Orientation', 'Orientation', 'None'],
  ['TRN-052', 'Carbon Monoxide Exposure', 'Safety', 'Training', 'None'],
].map(([training_id, training_name, category, training_type, default_expiration], idx) => ({
  training_id,
  training_name,
  category,
  training_type,
  default_expiration,
  active: 1,
  display_order: idx + 1,
}));

module.exports = MASTER_TRAININGS;
