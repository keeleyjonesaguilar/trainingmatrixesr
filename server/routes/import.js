// CSV Import (spec sections 5, 13, 14, 15, 20): client spreadsheets use wildly different
// column sets/terminology for the same 52 trainings. This flow never guesses silently -
// every training column is either auto-matched via the alias dictionary/exact catalog name,
// or queued in import_column_map as "needs_review" for a human to resolve before anything
// is written into employee_training_records. Nothing from the source file is discarded:
// the full raw row is kept in import_staged_rows.raw_row_json regardless of how columns resolve.
//
// Client is no longer pre-selected before upload (Keeley's request, 2026-08-20): every row
// carries its own "Client" column, auto-matched by exact name against existing clients where
// possible, and queued for manual selection (or "create new") otherwise - the same
// needs-review-before-commit discipline the training columns already use, just for clients.

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse/sync');
const { dbGet, dbAll, dbRun, withTransaction } = require('../db');
const repo = require('../lib/repo');
const { parseSourceValue, tryParseDate } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');
const { formatPhoneNumber } = require('../lib/phone');
const { maybeGenerateCertificate } = require('../lib/recordCertificates');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// "Qualified" identity patterns only - unambiguous even before we know whether the sheet is
// wide or long. Bare "Name" is deliberately excluded here: in a long-format sheet (spec below)
// that header almost always names the TRAINING, not the employee, so it can't be claimed until
// we've checked for that shape. See classifyHeaders() for the fallback that restores the old
// bare-"Name"-means-employee behavior for genuine wide sheets.
const IDENTITY_COLUMN_PATTERNS = {
  client: [/^client(\s*name)?$/i, /^company(\s*name)?$/i],
  first_name: [/^(employee\s*)?first\s*name$/i],
  last_name: [/^(employee\s*)?last\s*name$/i],
  trainer: [/^trainer(\s*name)?$/i, /^instructor(\s*name)?$/i],
  employee_number: [/^emp(loyee)?\s*#?\s*(number|no|id)$/i, /^emp\s*#$/i, /^id$/i, /^(employee\s*)?phone(\s*number)?$/i, /^cell(\s*(phone|number))?$/i, /^mobile(\s*(phone|number))?$/i],
  full_name: [/^employee\s*(full\s*)?name$/i, /^full\s*name$/i, /^employee$/i],
  job_title: [/^(job\s*)?title$/i, /^position$/i],
  department: [/^dept\.?$/i, /^department$/i],
  // Deliberately scoped to require "Employee" so it can't collide with a long-format sheet's
  // own record-level "Status" column (e.g. "Present/Expired") - see LONG_FORMAT_PATTERNS.status.
  employee_status: [/^employee\s*status$/i],
};
// Bare "Name" - only ever claimed as the employee identity when the sheet doesn't otherwise
// look like a long-format export (see classifyHeaders()). Kept separate for that reason.
const BARE_NAME_PATTERN = /^name$/i;

// A "long" sheet has one row per training completion rather than one row per employee - each
// row names its own training (this header) plus when it was completed/expires. Real exports
// from other systems (e.g. a certification tracker) come out this way; reshaping hundreds of
// rows into the wide one-column-per-training layout by hand invites transcription errors, so
// this format is detected and handled directly instead.
const LONG_FORMAT_PATTERNS = {
  training_name: [/^(training\s*)?name$/i, /^cert(ification)?\s*name$/i, /^record\s*name$/i, /^cert(ification)?$/i, /^training$/i],
  completion_date: [/^activation(\s*date)?$/i, /^completion(\s*date)?$/i, /^date\s*completed$/i, /^issue[d]?(\s*date)?$/i, /^cert(ification)?\s*date$/i, /^start(\s*date)?$/i],
  expiration_date: [/^expiration(\s*date)?$/i, /^exp(iry)?(\s*date)?$/i, /^valid\s*(through|until)$/i],
  record_type: [/^record\s*type$/i],
  status: [/^status$/i],
};

function normalize(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// An "Employee Status" column's value only ever flips a BRAND NEW employee to inactive at
// creation - it never touches an already-existing employee, same as job title/department, which
// the import also only ever sets once. Recognized inactive-shaped values only; anything blank,
// unrecognized, or affirmative ("Active", "Active Employee", "Current") defaults to active rather
// than guessing.
const INACTIVE_EMPLOYEE_STATUS_VALUES = new Set([
  'inactive', 'not active', 'terminated', 'termed', 'former', 'former employee',
  'no longer employed', 'separated', 'resigned', 'released',
]);
function parseEmployeeActiveStatus(raw) {
  const norm = normalize(raw);
  return norm && INACTIVE_EMPLOYEE_STATUS_VALUES.has(norm) ? 0 : 1;
}

function classifyIdentityColumn(header) {
  for (const [field, patterns] of Object.entries(IDENTITY_COLUMN_PATTERNS)) {
    if (patterns.some((p) => p.test(header.trim()))) return field;
  }
  return null;
}

function classifyLongFormatColumn(header) {
  for (const [field, patterns] of Object.entries(LONG_FORMAT_PATTERNS)) {
    if (patterns.some((p) => p.test(header.trim()))) return field;
  }
  return null;
}

// Splits every header into identity columns (client/name/trainer/etc.), long-format special
// columns (training name + completion/expiration dates, if the sheet looks like that shape),
// and - whatever's left - either wide-format training columns or, for a long sheet, columns
// that aren't needed for import but stay in raw_row_json regardless (nothing is discarded).
function classifyHeaders(headers) {
  const identityHeaders = {};
  const unclaimed = [];
  for (const h of headers) {
    const identityField = classifyIdentityColumn(h);
    if (identityField && !identityHeaders[identityField]) identityHeaders[identityField] = h;
    else unclaimed.push(h);
  }

  const longHeaders = {};
  for (const h of unclaimed) {
    const field = classifyLongFormatColumn(h);
    if (field && !longHeaders[field]) longHeaders[field] = h;
  }
  const isLongFormat = Boolean(longHeaders.training_name && longHeaders.completion_date && longHeaders.expiration_date);

  if (isLongFormat) {
    const claimed = new Set(Object.values(longHeaders));
    return { format: 'long', identityHeaders, longHeaders, trainingHeaders: unclaimed.filter((h) => !claimed.has(h)) };
  }

  // Not a long sheet - restore the old behavior where a bare "Name" column (no qualified
  // Employee/Full Name header present) is the employee identity, for backward compatibility
  // with wide sheets built before the First/Last Name split existed.
  if (!identityHeaders.full_name && !identityHeaders.first_name) {
    const bareName = unclaimed.find((h) => BARE_NAME_PATTERN.test(h.trim()));
    if (bareName) identityHeaders.full_name = bareName;
  }
  const trainingHeaders = unclaimed.filter((h) => h !== identityHeaders.full_name);
  return { format: 'wide', identityHeaders, longHeaders: {}, trainingHeaders };
}

// Words that show up in real spreadsheets' training column headers but say nothing about
// which training it is ("OSHA-10 Cert", "Ladder Training Completed") - stripped before the
// fuzzy containment check below so headers like these still line up with the catalog name.
const HEADER_NOISE_WORDS = new Set([
  'training', 'trainings', 'cert', 'certification', 'certificate', 'certified',
  'completed', 'completion', 'complete', 'date', 'course', 'class', 'status',
]);

function stripNoiseWords(normalized) {
  return normalized.split(' ').filter((w) => !HEADER_NOISE_WORDS.has(w)).join(' ').trim();
}

// Auto-matching beyond an exact alias/name hit (Keeley's report, 2026-08-25: most real sheets
// never use the catalog's exact wording, so almost every column was landing in "needs review"
// and forcing a fully manual pass every import). Two extra, deliberately conservative passes:
// 1) the training's own ID appears literally in the header ("TRN-001", "trn 001", etc.)
// 2) after stripping generic noise words, the header and a training's name contain one another
//    - and ONLY when that's true for exactly one training. Multiple candidates (e.g. a bare
//    "Safety" header matching several trainings) stays "needs_review" rather than guessing -
//    the whole point of this flow is to never guess silently, so ambiguity still goes to a human.
async function matchTrainingColumn(header) {
  const norm = normalize(header);
  const alias = await dbGet('SELECT training_id FROM training_aliases WHERE alias_text = ?', [norm]);
  if (alias) return { training_id: alias.training_id, confidence: 'exact_alias' };

  const allTrainings = await dbAll('SELECT training_id, training_name FROM master_trainings');

  const exactName = allTrainings.find((mt) => normalize(mt.training_name) === norm);
  if (exactName) return { training_id: exactName.training_id, confidence: 'exact_alias' };

  // 'fuzzy' is the only non-exact confidence value import_column_map's CHECK constraint
  // allows, so both the ID-in-header and noise-stripped-containment passes share it.
  const idMatch = allTrainings.find((mt) => norm.includes(normalize(mt.training_id)));
  if (idMatch) return { training_id: idMatch.training_id, confidence: 'fuzzy' };

  const strippedHeader = stripNoiseWords(norm);
  if (strippedHeader.length >= 3) {
    const candidates = allTrainings.filter((mt) => {
      const strippedName = stripNoiseWords(normalize(mt.training_name));
      if (strippedName.length < 3) return false;
      return strippedHeader.includes(strippedName) || strippedName.includes(strippedHeader);
    });
    if (candidates.length === 1) return { training_id: candidates[0].training_id, confidence: 'fuzzy' };
  }

  return { training_id: null, confidence: 'unmatched' };
}

// Downloadable starting-point sheet (Keeley's request): Client / Employee First Name /
// Employee Last Name / Trainer, then one column per active catalog training - using the
// training's exact name as the header, since that's the one thing matchTrainingColumn() is
// guaranteed to auto-match on a fresh import with no prior alias history. A cell under a
// training's column just holds that training's completion date for that row.
router.get('/template.csv', async (req, res) => {
  const trainings = await repo.listMasterTrainings({ activeOnly: true });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Client', 'Employee First Name', 'Employee Last Name', 'Trainer', ...trainings.map((t) => t.training_name)];
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="training-import-template.csv"');
  res.send(header.map(esc).join(','));
});

// Step 1: upload + preview. Parses headers, auto-matches training columns and client names,
// stages every raw row (nothing from the source file is ever discarded).
router.post('/preview', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }
  if (!records.length) return res.status(400).json({ error: 'CSV has no data rows' });

  const headers = Object.keys(records[0]);
  const { format, identityHeaders, longHeaders, trainingHeaders } = classifyHeaders(headers);

  if (!identityHeaders.client) {
    return res.status(400).json({ error: 'No "Client" column found - every row must specify which client it belongs to.' });
  }
  if (!identityHeaders.first_name && !identityHeaders.full_name) {
    return res.status(400).json({ error: 'No name column found - include "Employee First Name"/"Employee Last Name" (or a single "Full Name"/"Employee Full Name" column).' });
  }

  const batchId = uuidv4();
  await dbRun('INSERT INTO import_batches (batch_id, filename, imported_at, status, imported_by, format, format_meta) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    batchId,
    req.file.originalname,
    new Date().toISOString(),
    'pending_review',
    req.user ? req.user.username : null,
    format,
    format === 'long' ? JSON.stringify(longHeaders) : null,
  ]);

  // Wide format: one column_map row per training COLUMN HEADER (a cell under it holds that
  // training's completion date). Long format: one column_map row per distinct raw TRAINING
  // NAME VALUE found in the training-name column (every row under that value shares the
  // match). Either way, matching/resolution works identically from here on.
  const columnMapLabels = format === 'long'
    ? [...new Set(records.map((row) => (row[longHeaders.training_name] || '').trim()).filter(Boolean))]
    : trainingHeaders;

  const columnMapPreview = [];
  for (const label of columnMapLabels) {
    const { training_id, confidence } = await matchTrainingColumn(label);
    const resolution = training_id ? 'auto_matched' : 'needs_review';
    const mapId = uuidv4();
    await dbRun(
      `INSERT INTO import_column_map (map_id, batch_id, source_column_header, matched_training_id, match_confidence, resolution_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mapId, batchId, label, training_id, confidence, resolution]
    );
    columnMapPreview.push({ map_id: mapId, source_column_header: label, matched_training_id: training_id, match_confidence: confidence, resolution_status: resolution });
  }

  // Existing clients loaded once, matched in memory - exact, case-insensitive, same rule
  // repo.findOrCreateClientByName uses elsewhere, just without the auto-create.
  const existingClients = await dbAll('SELECT client_id, client_name FROM clients WHERE is_internal = 0');
  const findClientId = (rawName) => {
    const trimmed = String(rawName || '').trim().toLowerCase();
    if (!trimmed) return null;
    const match = existingClients.find((c) => c.client_name.trim().toLowerCase() === trimmed);
    return match ? match.client_id : null;
  };

  await withTransaction(async () => {
    for (const row of records) {
      const firstName = identityHeaders.first_name ? (row[identityHeaders.first_name] || '').trim() : '';
      const lastName = identityHeaders.last_name ? (row[identityHeaders.last_name] || '').trim() : '';
      const fullName = identityHeaders.full_name
        ? (row[identityHeaders.full_name] || '').trim()
        : `${firstName} ${lastName}`.trim();
      const clientNameRaw = row[identityHeaders.client] || '';

      await dbRun(
        `INSERT INTO import_staged_rows
         (staged_row_id, batch_id, employee_number_raw, full_name_raw, job_title_raw, department_raw,
          client_name_raw, resolved_client_id, first_name_raw, last_name_raw, trainer_name_raw, raw_row_json,
          training_name_raw, completion_date_raw, expiration_date_raw, record_type_raw, employee_status_raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          batchId,
          identityHeaders.employee_number ? row[identityHeaders.employee_number] : null,
          fullName || null,
          identityHeaders.job_title ? row[identityHeaders.job_title] : null,
          identityHeaders.department ? row[identityHeaders.department] : null,
          clientNameRaw,
          findClientId(clientNameRaw),
          firstName || null,
          lastName || null,
          identityHeaders.trainer ? row[identityHeaders.trainer] : null,
          JSON.stringify(row),
          format === 'long' ? (row[longHeaders.training_name] || null) : null,
          format === 'long' ? (row[longHeaders.completion_date] || null) : null,
          format === 'long' ? (row[longHeaders.expiration_date] || null) : null,
          format === 'long' && longHeaders.record_type ? (row[longHeaders.record_type] || null) : null,
          identityHeaders.employee_status ? row[identityHeaders.employee_status] : null,
        ]
      );
    }
  });

  const clientsNeedingReview = await dbAll(
    `SELECT client_name_raw, COUNT(*) AS row_count FROM import_staged_rows
     WHERE batch_id = ? AND resolved_client_id IS NULL AND client_name_raw != ''
     GROUP BY client_name_raw`,
    [batchId]
  );

  res.status(201).json({
    batch_id: batchId,
    format,
    row_count: records.length,
    identity_columns_detected: identityHeaders,
    column_map: columnMapPreview,
    needs_review_count: columnMapPreview.filter((c) => c.resolution_status === 'needs_review').length,
    clients_needing_review: clientsNeedingReview,
  });
});

router.get('/batches/:batchId', async (req, res) => {
  const batch = await dbGet('SELECT * FROM import_batches WHERE batch_id = ?', [req.params.batchId]);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const columnMap = await dbAll('SELECT * FROM import_column_map WHERE batch_id = ?', [req.params.batchId]);
  const { n: rowCount } = await dbGet('SELECT COUNT(*) AS n FROM import_staged_rows WHERE batch_id = ?', [req.params.batchId]);
  const clientsNeedingReview = await dbAll(
    `SELECT client_name_raw, COUNT(*) AS row_count FROM import_staged_rows
     WHERE batch_id = ? AND resolved_client_id IS NULL AND client_name_raw != ''
     GROUP BY client_name_raw`,
    [req.params.batchId]
  );
  res.json({ batch, column_map: columnMap, row_count: rowCount, clients_needing_review: clientsNeedingReview });
});

// Step 2a: manually resolve an ambiguous/unmatched column. Remembers the choice as a new alias
// so the same client terminology auto-matches next time (spec section 5).
router.put('/batches/:batchId/column-map/:mapId', requireAdmin, async (req, res) => {
  const map = await dbGet('SELECT * FROM import_column_map WHERE map_id = ? AND batch_id = ?', [req.params.mapId, req.params.batchId]);
  if (!map) return res.status(404).json({ error: 'Column mapping not found' });

  const { training_id, ignore } = req.body;
  if (ignore) {
    await dbRun('UPDATE import_column_map SET resolution_status = ?, matched_training_id = NULL WHERE map_id = ?', ['ignored', req.params.mapId]);
    return res.json(await dbGet('SELECT * FROM import_column_map WHERE map_id = ?', [req.params.mapId]));
  }
  if (!training_id) return res.status(400).json({ error: 'training_id or ignore is required' });
  const mt = await repo.getMasterTraining(training_id);
  if (!mt) return res.status(400).json({ error: 'training_id does not exist' });

  await dbRun('UPDATE import_column_map SET matched_training_id = ?, match_confidence = ?, resolution_status = ? WHERE map_id = ?', [
    training_id,
    'manual',
    'resolved',
    req.params.mapId,
  ]);

  const aliasText = normalize(map.source_column_header);
  await dbRun(
    `INSERT INTO training_aliases (alias_id, alias_text, training_id) VALUES (?, ?, ?)
     ON CONFLICT(alias_text) DO UPDATE SET training_id = excluded.training_id`,
    [uuidv4(), aliasText, training_id]
  );

  res.json(await dbGet('SELECT * FROM import_column_map WHERE map_id = ?', [req.params.mapId]));
});

// Step 2b: manually resolve a client name the automatch couldn't confidently match - either
// point every row that used this raw name at an existing client, or create a new one from it.
router.put('/batches/:batchId/resolve-client', requireAdmin, async (req, res) => {
  const { client_name_raw, client_id, create_new } = req.body || {};
  if (!client_name_raw) return res.status(400).json({ error: 'client_name_raw is required' });

  let resolvedId = client_id;
  if (create_new) {
    resolvedId = await repo.findOrCreateClientByName(client_name_raw);
  }
  if (!resolvedId) return res.status(400).json({ error: 'client_id or create_new is required' });
  const client = await dbGet('SELECT * FROM clients WHERE client_id = ?', [resolvedId]);
  if (!client) return res.status(400).json({ error: 'client_id does not exist' });

  await dbRun('UPDATE import_staged_rows SET resolved_client_id = ? WHERE batch_id = ? AND client_name_raw = ?', [
    resolvedId,
    req.params.batchId,
    client_name_raw,
  ]);
  res.json({ client_name_raw, resolved_client_id: resolvedId, client });
});

// Step 3: commit. Can be called more than once per batch (Keeley's request, 2026-09-01): every
// training mapping that's already resolved gets committed right away - rows using a mapping
// still stuck in needs_review are simply left for the next commit, once someone resolves it via
// the column-map endpoint above. The same applies to a row whose Client couldn't be resolved:
// it's skipped this round (counted below) and picked up once resolved. Every record created
// remembers its import_batch_id, so a later commit call can tell exactly which (employee,
// training, completion date) combinations this batch already created and skip only those -
// nothing is recreated, and nothing is permanently locked out just because it wasn't eligible
// yet on an earlier call.
router.post('/batches/:batchId/commit', requireAdmin, async (req, res) => {
  const batch = await dbGet('SELECT * FROM import_batches WHERE batch_id = ?', [req.params.batchId]);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!['pending_review', 'partially_committed'].includes(batch.status)) {
    return res.status(409).json({ error: `Batch already ${batch.status}` });
  }

  const columnMap = await dbAll('SELECT * FROM import_column_map WHERE batch_id = ?', [req.params.batchId]);
  const stagedRows = await dbAll('SELECT * FROM import_staged_rows WHERE batch_id = ?', [req.params.batchId]);

  let employeesCreated = 0;
  let recordsCreated = 0;
  let recordsNeedingReview = 0;
  let rowsSkippedNoClient = 0;
  let rowsSkippedNoTrainingName = 0;
  const createdRecordIds = [];

  await withTransaction(async () => {
    // One pass to sort out which rows can be attached to anything at all right now, and to
    // find-or-create each row's employee exactly once regardless of how many training mappings
    // end up applying to it below.
    const eligibleRows = [];
    const rowContextById = new Map();
    for (const row of stagedRows) {
      const fullName = (row.full_name_raw || '').trim();
      if (!fullName) continue; // can't create an employee with no identifying name - row preserved in raw_row_json regardless
      if (!row.resolved_client_id) { rowsSkippedNoClient += 1; continue; } // blank/unresolved Client - nothing to attach this row to yet
      if (batch.format === 'long' && !(row.training_name_raw || '').trim()) {
        rowsSkippedNoTrainingName += 1; // nothing to attach this row to - preserved in raw_row_json regardless
        continue;
      }

      const clientId = row.resolved_client_id;
      let employee = await dbGet(
        // Postgres can't infer a type for a bare "? IS NULL" placeholder (no column context to
        // infer from, unlike SQLite's fully dynamic typing) - cast makes the parameter type explicit.
        'SELECT * FROM employees WHERE client_id = ? AND LOWER(full_name) = ? AND (employee_number = ? OR ?::text IS NULL)',
        [clientId, fullName.toLowerCase(), row.employee_number_raw, row.employee_number_raw]
      );
      if (!employee) {
        const employeeId = uuidv4();
        await dbRun(
          `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, department, active, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            employeeId,
            clientId,
            formatPhoneNumber(row.employee_number_raw),
            fullName,
            row.job_title_raw,
            row.department_raw,
            parseEmployeeActiveStatus(row.employee_status_raw),
            `Created by import: ${batch.filename}`,
          ]
        );
        employee = await dbGet('SELECT * FROM employees WHERE employee_id = ?', [employeeId]);
        employeesCreated += 1;
      }
      const trainerEmployeeId = row.trainer_name_raw ? await repo.findOrCreateTrainerEmployee(row.trainer_name_raw) : null;

      eligibleRows.push(row);
      rowContextById.set(row.staged_row_id, { employee, clientId, trainerEmployeeId });
    }

    // Long format only: group eligible rows by their raw training-name value so each mapping
    // below can look up exactly the rows it applies to, the same way a wide-format mapping
    // applies to a single column across every row.
    const rowsByTrainingName = new Map();
    if (batch.format === 'long') {
      for (const row of eligibleRows) {
        const key = row.training_name_raw.trim();
        if (!rowsByTrainingName.has(key)) rowsByTrainingName.set(key, []);
        rowsByTrainingName.get(key).push(row);
      }
    }

    const now = new Date().toISOString();
    for (const col of columnMap) {
      if (col.resolution_status === 'ignored' || col.resolution_status === 'needs_review') continue;
      if (!col.matched_training_id) continue;

      const masterTraining = await repo.getMasterTraining(col.matched_training_id);
      const rowsForThisMapping = batch.format === 'long' ? (rowsByTrainingName.get(col.source_column_header) || []) : eligibleRows;

      for (const row of rowsForThisMapping) {
        const { employee, clientId, trainerEmployeeId } = rowContextById.get(row.staged_row_id);

        let parsed;
        let explicitExpiration = null;
        let originalClientTrainingName;
        let notes = null;
        if (batch.format === 'long') {
          // The source's own Expiration date (if any) is written to source_expiration_date,
          // which statusEngine.resolveExpiration treats as the record's explicit override and
          // always prefers over a computed catalog/client duration - so a migrated record shows
          // exactly the status the source system did, not whatever the (still largely
          // unconfigured) Master Catalog default would compute.
          parsed = parseSourceValue(row.completion_date_raw);
          explicitExpiration = tryParseDate((row.expiration_date_raw || '').trim());
          originalClientTrainingName = row.training_name_raw.trim();
          notes = row.record_type_raw ? `Record type: ${row.record_type_raw}` : null;
        } else {
          const rawRow = JSON.parse(row.raw_row_json);
          const cellValue = rawRow[col.source_column_header];
          if (cellValue === undefined || cellValue === null || String(cellValue).trim() === '') continue; // spec 13: blank isn't proof of anything - skip, don't create a false "Missing" record
          parsed = parseSourceValue(cellValue);
          originalClientTrainingName = col.source_column_header;
        }

        // A prior partial commit on this batch may have already created exactly this
        // (employee, training, source label, completion date) record - e.g. this mapping was
        // resolved and committed already, and we're re-running after resolving something else
        // (a different mapping, or a client) that had blocked other rows. Skip it rather than
        // creating a duplicate; null-safe on completion_date since a blank/unparsed source value
        // still stages a record (flagged "Pending Review") that a re-commit shouldn't double up.
        const alreadyCommitted = await dbGet(
          `SELECT 1 FROM employee_training_records
           WHERE import_batch_id = ? AND employee_id = ? AND training_id = ? AND original_client_training_name = ?
             AND (completion_date = ? OR (completion_date IS NULL AND ?::text IS NULL))`,
          [req.params.batchId, employee.employee_id, col.matched_training_id, originalClientTrainingName, parsed.completion_date, parsed.completion_date]
        );
        if (alreadyCommitted) continue;

        const recordId = uuidv4();
        await dbRun(
          `INSERT INTO employee_training_records
           (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
            completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
            trainer_employee_id, import_batch_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?, ?, ?, ?, ?)`,
          [
            recordId,
            clientId,
            employee.employee_id,
            col.matched_training_id,
            masterTraining.training_name,
            originalClientTrainingName,
            parsed.completion_date,
            explicitExpiration,
            parsed.raw_source_value,
            `Import: ${batch.filename}`,
            notes,
            trainerEmployeeId,
            req.params.batchId,
            now,
            now,
          ]
        );
        const persisted = await repo.recomputeAndPersistRecord(recordId);
        if (persisted && persisted.status === 'Pending Review') recordsNeedingReview += 1;
        recordsCreated += 1;
        createdRecordIds.push(recordId);
      }
    }

    const stillNeedsReview = columnMap.some((c) => c.resolution_status === 'needs_review');
    const newStatus = stillNeedsReview ? 'partially_committed' : 'committed';
    await dbRun(
      `UPDATE import_batches
       SET status = ?, records_imported = COALESCE(records_imported, 0) + ?, records_needing_review = COALESCE(records_needing_review, 0) + ?
       WHERE batch_id = ?`,
      [newStatus, recordsCreated, recordsNeedingReview, req.params.batchId]
    );
  });

  const finalBatch = await dbGet('SELECT * FROM import_batches WHERE batch_id = ?', [req.params.batchId]);

  res.json({
    batch_id: req.params.batchId,
    status: finalBatch.status,
    employees_created: employeesCreated,
    records_created: recordsCreated,
    records_needing_review: recordsNeedingReview,
    rows_skipped_no_client: rowsSkippedNoClient,
    rows_skipped_no_training_name: rowsSkippedNoTrainingName,
    still_needs_review_count: columnMap.filter((c) => c.resolution_status === 'needs_review').length,
  });

  // Certificates are generated after responding, one at a time in the background (Keeley's
  // request to auto-generate them for imported completions too) - an import can create
  // hundreds of records at once, and building that many PDFs synchronously inside the request
  // would make large imports painfully slow. A failure on one record is logged and skipped;
  // it never blocks the rest or the commit itself, which has already succeeded by this point.
  (async () => {
    for (const recordId of createdRecordIds) {
      // eslint-disable-next-line no-await-in-loop
      await maybeGenerateCertificate(recordId).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`Certificate auto-generation failed for imported record ${recordId}:`, err);
      });
    }
  })();
});

router.delete('/batches/:batchId', requireAdmin, async (req, res) => {
  const batch = await dbGet('SELECT * FROM import_batches WHERE batch_id = ?', [req.params.batchId]);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  await dbRun('UPDATE import_batches SET status = ? WHERE batch_id = ?', ['cancelled', req.params.batchId]);
  res.status(204).end();
});

module.exports = router;
