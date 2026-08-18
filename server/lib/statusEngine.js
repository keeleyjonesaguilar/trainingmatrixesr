// Single source of truth for status + expiration calculation (spec section 6, 12, 13, 18).
// Nothing else in the app should compute status independently - routes call
// computeStatusForRecord() / recomputeAndPersist() so the matrix, dashboard, employee detail,
// and training detail pages can never drift out of sync with each other.

const EXPIRATION_UNITS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];

function addPeriod(isoDateStr, unit) {
  if (!isoDateStr) return null;
  const years = { '1 Year': 1, '2 Years': 2, '3 Years': 3, '5 Years': 5 }[unit];
  if (!years) return null; // 'None' or unknown
  const d = new Date(isoDateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolution hierarchy (spec section 18):
 *   1. The individual Employee Training Record's own explicit expiration date, if set
 *   2. The Client Training Requirements override for this client+training, if set
 *   3. The Master Training Catalog default expiration
 *   4. If Master says "None", there is no expiration
 */
function resolveExpiration({ record, requirement, masterTraining }) {
  if (record && record.source_expiration_date) {
    return { expirationDate: record.source_expiration_date, resolvedFrom: 'record_override' };
  }
  const completionDate = record && record.completion_date;
  if (requirement && requirement.client_expiration_unit) {
    if (requirement.client_expiration_unit === 'None') {
      return { expirationDate: null, resolvedFrom: 'client_override' };
    }
    return { expirationDate: addPeriod(completionDate, requirement.client_expiration_unit), resolvedFrom: 'client_override' };
  }
  const masterUnit = masterTraining ? masterTraining.default_expiration : 'None';
  if (masterUnit === 'None') {
    return { expirationDate: null, resolvedFrom: 'master_default' };
  }
  return { expirationDate: addPeriod(completionDate, masterUnit), resolvedFrom: 'master_default' };
}

function effectiveRequirementStatus(requirement) {
  // Absence of a client_training_requirements row means "Required, use Master default" (spec section 18/19).
  return requirement ? requirement.requirement_status : 'Required';
}

/**
 * Computes status + resolved expiration for one (employee, training) combination.
 * `record` may be null (no Employee Training Record exists yet for this pair).
 * `today` is an ISO date string (injected for testability; defaults to current UTC date).
 */
function computeStatus({ record, requirement, masterTraining, today }) {
  const asOf = today || new Date().toISOString().slice(0, 10);
  const reqStatus = effectiveRequirementStatus(requirement);

  // Client-level Not Applicable always wins - the training doesn't apply to this client at all.
  if (reqStatus === 'Not Applicable') {
    return { status: 'Not Applicable', expirationDate: null };
  }

  if (!record) {
    // No record on file at all.
    if (reqStatus === 'Required') return { status: 'Missing', expirationDate: null };
    // Not Required / Optional with nothing on file - no compliance gap to flag.
    return { status: 'Not Applicable', expirationDate: null };
  }

  const raw = (record.raw_source_value || '').trim().toUpperCase();

  // Explicit N/A from source always means Not Applicable, regardless of client requirement config.
  if (raw === 'N/A' || raw === 'NA') {
    return { status: 'Not Applicable', expirationDate: null };
  }

  // Explicit NO with no completion date: employee confirmed lacking the training.
  if (raw === 'NO' && !record.completion_date) {
    return { status: 'Missing', expirationDate: null };
  }

  // YES with no completion date, or any record with no completion date and no clear
  // negative/N-A signal: never fabricate a date - flag for human review instead.
  if (!record.completion_date) {
    return { status: 'Pending Review', expirationDate: null };
  }

  const { expirationDate } = resolveExpiration({ record, requirement, masterTraining });

  if (!expirationDate) {
    return { status: 'No Expiration', expirationDate: null };
  }
  if (asOf >= expirationDate) {
    return { status: 'Expired', expirationDate };
  }
  return { status: 'Current', expirationDate };
}

/**
 * Interprets a raw source cell value (spec section 13) into structured fields for a new/updated
 * Employee Training Record, without inventing information that wasn't in the source.
 * Accepts: YES, NO, N/A, blank, an ISO-ish date, a date range / free text like "Jan-Feb 2025".
 */
function parseSourceValue(rawValue) {
  const trimmed = (rawValue == null ? '' : String(rawValue)).trim();
  if (trimmed === '') {
    return { raw_source_value: '', completion_date: null, source_expiration_date: null };
  }
  const upper = trimmed.toUpperCase();
  if (upper === 'N/A' || upper === 'NA') {
    return { raw_source_value: trimmed, completion_date: null, source_expiration_date: null };
  }
  if (upper === 'NO') {
    return { raw_source_value: trimmed, completion_date: null, source_expiration_date: null };
  }
  if (upper === 'YES' || upper === 'Y') {
    return { raw_source_value: trimmed, completion_date: null, source_expiration_date: null };
  }
  // Try to parse as a real date (accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY, etc.)
  const parsedDate = tryParseDate(trimmed);
  if (parsedDate) {
    return { raw_source_value: trimmed, completion_date: parsedDate, source_expiration_date: null };
  }
  // Free text / date range ("Jan-Feb 2025") - preserve verbatim, don't guess a date, flag for review.
  return { raw_source_value: trimmed, completion_date: null, source_expiration_date: null };
}

function tryParseDate(text) {
  // YYYY-MM-DD
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // M/D/YYYY or MM/DD/YYYY
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  // M/D/YY
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const [, mo, da, yr] = m;
    const fullYear = Number(yr) < 50 ? `20${yr}` : `19${yr}`;
    return `${fullYear}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  return null;
}

module.exports = {
  EXPIRATION_UNITS,
  addPeriod,
  resolveExpiration,
  computeStatus,
  parseSourceValue,
  tryParseDate,
};
