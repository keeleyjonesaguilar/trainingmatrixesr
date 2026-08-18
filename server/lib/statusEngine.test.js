// Quick smoke tests for the status engine - run with: node server/lib/statusEngine.test.js
const assert = require('assert');
const { computeStatus, resolveExpiration, addPeriod, parseSourceValue } = require('./statusEngine');

const masterNone = { default_expiration: 'None' };
const master1yr = { default_expiration: '1 Year' };

// 1. No record, Required -> Missing
assert.strictEqual(computeStatus({ record: null, requirement: null, masterTraining: master1yr, today: '2026-08-13' }).status, 'Missing');

// 2. No record, client requirement Not Applicable -> Not Applicable
assert.strictEqual(computeStatus({ record: null, requirement: { requirement_status: 'Not Applicable' }, masterTraining: master1yr, today: '2026-08-13' }).status, 'Not Applicable');

// 3. No record, Optional -> Not Applicable (no compliance gap)
assert.strictEqual(computeStatus({ record: null, requirement: { requirement_status: 'Optional' }, masterTraining: master1yr, today: '2026-08-13' }).status, 'Not Applicable');

// 4. Record with raw NO, no completion date -> Missing
assert.strictEqual(computeStatus({ record: { raw_source_value: 'NO', completion_date: null }, requirement: null, masterTraining: master1yr, today: '2026-08-13' }).status, 'Missing');

// 5. Record with raw YES, no completion date -> Pending Review (never fabricate a date)
assert.strictEqual(computeStatus({ record: { raw_source_value: 'YES', completion_date: null }, requirement: null, masterTraining: master1yr, today: '2026-08-13' }).status, 'Pending Review');

// 6. Record with N/A raw value -> Not Applicable regardless of requirement
assert.strictEqual(computeStatus({ record: { raw_source_value: 'N/A', completion_date: null }, requirement: { requirement_status: 'Required' }, masterTraining: master1yr, today: '2026-08-13' }).status, 'Not Applicable');

// 7. Completion date within 1 year default -> Current
{
  const r = computeStatus({ record: { completion_date: '2026-06-01', raw_source_value: '2026-06-01' }, requirement: null, masterTraining: master1yr, today: '2026-08-13' });
  assert.strictEqual(r.status, 'Current');
  assert.strictEqual(r.expirationDate, '2027-06-01');
}

// 8. Completion date beyond 1 year default -> Expired
{
  const r = computeStatus({ record: { completion_date: '2024-01-01', raw_source_value: '2024-01-01' }, requirement: null, masterTraining: master1yr, today: '2026-08-13' });
  assert.strictEqual(r.status, 'Expired');
  assert.strictEqual(r.expirationDate, '2025-01-01');
}

// 9. Master says None, completion date present -> No Expiration
{
  const r = computeStatus({ record: { completion_date: '2020-01-01', raw_source_value: '2020-01-01' }, requirement: null, masterTraining: masterNone, today: '2026-08-13' });
  assert.strictEqual(r.status, 'No Expiration');
}

// 10. Record's own explicit expiration date wins over client override and master default
{
  const record = { completion_date: '2024-01-01', source_expiration_date: '2030-01-01', raw_source_value: '2024-01-01' };
  const requirement = { requirement_status: 'Required', client_expiration_unit: '1 Year' };
  const res = resolveExpiration({ record, requirement, masterTraining: master1yr });
  assert.strictEqual(res.expirationDate, '2030-01-01');
  assert.strictEqual(res.resolvedFrom, 'record_override');
}

// 11. Client override wins over master default when no record-level explicit date
{
  const record = { completion_date: '2024-01-01', raw_source_value: '2024-01-01' };
  const requirement = { requirement_status: 'Required', client_expiration_unit: '3 Years' };
  const res = resolveExpiration({ record, requirement, masterTraining: master1yr });
  assert.strictEqual(res.expirationDate, '2027-01-01');
  assert.strictEqual(res.resolvedFrom, 'client_override');
}

// 12. Master default used when neither record nor client override present
{
  const record = { completion_date: '2024-01-01', raw_source_value: '2024-01-01' };
  const res = resolveExpiration({ record, requirement: null, masterTraining: master1yr });
  assert.strictEqual(res.expirationDate, '2025-01-01');
  assert.strictEqual(res.resolvedFrom, 'master_default');
}

// 12b. Rule 9: a record completed before the requirement's effective_date, with an
// already-persisted expiration_date, keeps that frozen value even though the *current*
// override would compute something different.
{
  const record = { completion_date: '2020-01-01', expiration_date: '2021-01-01', raw_source_value: '2020-01-01' };
  const requirement = { requirement_status: 'Required', client_expiration_unit: '3 Years', effective_date: '2026-08-18' };
  const res = resolveExpiration({ record, requirement, masterTraining: master1yr });
  assert.strictEqual(res.expirationDate, '2021-01-01');
  assert.strictEqual(res.resolvedFrom, 'frozen_pre_override_change');
}

// 12c. Rule 9 (continued): a record completed on/after the effective_date uses the current
// override as normal - the freeze only protects records from before the change.
{
  const record = { completion_date: '2026-09-01', raw_source_value: '2026-09-01' };
  const requirement = { requirement_status: 'Required', client_expiration_unit: '3 Years', effective_date: '2026-08-18' };
  const res = resolveExpiration({ record, requirement, masterTraining: master1yr });
  assert.strictEqual(res.expirationDate, '2029-09-01');
  assert.strictEqual(res.resolvedFrom, 'client_override');
}

// 13. addPeriod basic
assert.strictEqual(addPeriod('2026-08-13', '3 Years'), '2029-08-13');
assert.strictEqual(addPeriod('2026-08-13', 'None'), null);

// 14. parseSourceValue: blank
assert.deepStrictEqual(parseSourceValue(''), { raw_source_value: '', completion_date: null, source_expiration_date: null });

// 15. parseSourceValue: N/A
assert.strictEqual(parseSourceValue('N/A').completion_date, null);

// 16. parseSourceValue: real date MM/DD/YYYY
assert.strictEqual(parseSourceValue('6/1/2026').completion_date, '2026-06-01');

// 17. parseSourceValue: free text / date range preserved, no fabricated date
{
  const r = parseSourceValue('Jan-Feb 2025');
  assert.strictEqual(r.completion_date, null);
  assert.strictEqual(r.raw_source_value, 'Jan-Feb 2025');
}

console.log('All statusEngine smoke tests passed.');
