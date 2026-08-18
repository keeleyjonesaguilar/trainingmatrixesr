// CSV Import (spec sections 5, 13, 14, 15, 20): client spreadsheets use wildly different
// column sets/terminology for the same 52 trainings. This flow never guesses silently -
// every training column is either auto-matched via the alias dictionary/exact catalog name,
// or queued in import_column_map as "needs_review" for a human to resolve before anything
// is written into employee_training_records. Nothing from the source file is discarded:
// the full raw row is kept in import_staged_rows.raw_row_json regardless of how columns resolve.

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const repo = require('../lib/repo');
const { parseSourceValue } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');
const { formatPhoneNumber } = require('../lib/phone');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const IDENTITY_COLUMN_PATTERNS = {
  employee_number: [/^emp(loyee)?\s*#?\s*(number|no|id)$/i, /^emp\s*#$/i, /^id$/i, /^(employee\s*)?phone(\s*number)?$/i, /^cell(\s*(phone|number))?$/i, /^mobile(\s*(phone|number))?$/i],
  full_name: [/^(employee\s*)?(full\s*)?name$/i, /^employee$/i],
  job_title: [/^(job\s*)?title$/i, /^position$/i],
  department: [/^dept\.?$/i, /^department$/i],
};

function normalize(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyIdentityColumn(header) {
  for (const [field, patterns] of Object.entries(IDENTITY_COLUMN_PATTERNS)) {
    if (patterns.some((p) => p.test(header.trim()))) return field;
  }
  return null;
}

function matchTrainingColumn(header) {
  const norm = normalize(header);
  const alias = db.prepare('SELECT training_id FROM training_aliases WHERE alias_text = ?').get(norm);
  if (alias) return { training_id: alias.training_id, confidence: 'exact_alias' };
  const master = db
    .prepare('SELECT training_id, training_name FROM master_trainings')
    .all()
    .find((mt) => normalize(mt.training_name) === norm);
  if (master) return { training_id: master.training_id, confidence: 'exact_alias' };
  return { training_id: null, confidence: 'unmatched' };
}

// Step 1: upload + preview. Parses headers, auto-matches what it can, stages every raw row.
router.post('/:clientId/preview', requireAdmin, upload.single('file'), (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }
  if (!records.length) return res.status(400).json({ error: 'CSV has no data rows' });

  const headers = Object.keys(records[0]);
  const identityHeaders = {};
  const trainingHeaders = [];
  for (const h of headers) {
    const identityField = classifyIdentityColumn(h);
    if (identityField && !identityHeaders[identityField]) {
      identityHeaders[identityField] = h;
    } else {
      trainingHeaders.push(h);
    }
  }

  const batchId = uuidv4();
  db.prepare('INSERT INTO import_batches (batch_id, client_id, filename, imported_at, status, imported_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    batchId,
    req.params.clientId,
    req.file.originalname,
    new Date().toISOString(),
    'pending_review',
    req.user ? req.user.username : null
  );

  const insertMap = db.prepare(
    `INSERT INTO import_column_map (map_id, batch_id, source_column_header, matched_training_id, match_confidence, resolution_status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const columnMapPreview = [];
  for (const h of trainingHeaders) {
    const { training_id, confidence } = matchTrainingColumn(h);
    const resolution = training_id ? 'auto_matched' : 'needs_review';
    const mapId = uuidv4();
    insertMap.run(mapId, batchId, h, training_id, confidence, resolution);
    columnMapPreview.push({ map_id: mapId, source_column_header: h, matched_training_id: training_id, match_confidence: confidence, resolution_status: resolution });
  }

  const insertRow = db.prepare(
    `INSERT INTO import_staged_rows (staged_row_id, batch_id, employee_number_raw, full_name_raw, job_title_raw, department_raw, raw_row_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const txn = db.transaction((rows) => {
    for (const row of rows) {
      insertRow.run(
        uuidv4(),
        batchId,
        identityHeaders.employee_number ? row[identityHeaders.employee_number] : null,
        identityHeaders.full_name ? row[identityHeaders.full_name] : null,
        identityHeaders.job_title ? row[identityHeaders.job_title] : null,
        identityHeaders.department ? row[identityHeaders.department] : null,
        JSON.stringify(row)
      );
    }
  });
  txn(records);

  res.status(201).json({
    batch_id: batchId,
    client,
    row_count: records.length,
    identity_columns_detected: identityHeaders,
    column_map: columnMapPreview,
    needs_review_count: columnMapPreview.filter((c) => c.resolution_status === 'needs_review').length,
  });
});

router.get('/batches/:batchId', (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const columnMap = db.prepare('SELECT * FROM import_column_map WHERE batch_id = ?').all(req.params.batchId);
  const rowCount = db.prepare('SELECT COUNT(*) AS n FROM import_staged_rows WHERE batch_id = ?').get(req.params.batchId).n;
  res.json({ batch, column_map: columnMap, row_count: rowCount });
});

// Step 2: manually resolve an ambiguous/unmatched column. Remembers the choice as a new alias
// so the same client terminology auto-matches next time (spec section 5).
router.put('/batches/:batchId/column-map/:mapId', requireAdmin, (req, res) => {
  const map = db.prepare('SELECT * FROM import_column_map WHERE map_id = ? AND batch_id = ?').get(req.params.mapId, req.params.batchId);
  if (!map) return res.status(404).json({ error: 'Column mapping not found' });

  const { training_id, ignore } = req.body;
  if (ignore) {
    db.prepare('UPDATE import_column_map SET resolution_status = ?, matched_training_id = NULL WHERE map_id = ?').run('ignored', req.params.mapId);
    return res.json(db.prepare('SELECT * FROM import_column_map WHERE map_id = ?').get(req.params.mapId));
  }
  if (!training_id) return res.status(400).json({ error: 'training_id or ignore is required' });
  const mt = repo.getMasterTraining(training_id);
  if (!mt) return res.status(400).json({ error: 'training_id does not exist' });

  db.prepare('UPDATE import_column_map SET matched_training_id = ?, match_confidence = ?, resolution_status = ? WHERE map_id = ?').run(
    training_id,
    'manual',
    'resolved',
    req.params.mapId
  );

  const aliasText = normalize(map.source_column_header);
  db.prepare(
    `INSERT INTO training_aliases (alias_id, alias_text, training_id) VALUES (?, ?, ?)
     ON CONFLICT(alias_text) DO UPDATE SET training_id = excluded.training_id`
  ).run(uuidv4(), aliasText, training_id);

  res.json(db.prepare('SELECT * FROM import_column_map WHERE map_id = ?').get(req.params.mapId));
});

// Step 3: commit. Every training column must be resolved (mapped or ignored) first - nothing
// ambiguous is ever silently written in.
router.post('/batches/:batchId/commit', requireAdmin, (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'pending_review') return res.status(409).json({ error: `Batch already ${batch.status}` });

  const columnMap = db.prepare('SELECT * FROM import_column_map WHERE batch_id = ?').all(req.params.batchId);
  const pending = columnMap.filter((c) => c.resolution_status === 'needs_review');
  if (pending.length) {
    return res.status(400).json({ error: 'Some columns still need review before committing', pending_columns: pending });
  }

  const activeMap = columnMap.filter((c) => c.resolution_status !== 'ignored' && c.matched_training_id);
  const stagedRows = db.prepare('SELECT * FROM import_staged_rows WHERE batch_id = ?').all(req.params.batchId);

  let employeesCreated = 0;
  let recordsCreated = 0;
  let duplicatesFlagged = 0;
  let recordsNeedingReview = 0;

  const txn = db.transaction(() => {
    for (const row of stagedRows) {
      const rawRow = JSON.parse(row.raw_row_json);
      const fullName = (row.full_name_raw || '').trim();
      if (!fullName) continue; // can't create an employee with no identifying name - row preserved in raw_row_json regardless

      let employee = db
        .prepare('SELECT * FROM employees WHERE client_id = ? AND LOWER(full_name) = ? AND (employee_number = ? OR ? IS NULL)')
        .get(batch.client_id, fullName.toLowerCase(), row.employee_number_raw, row.employee_number_raw);

      if (!employee) {
        const employeeId = uuidv4();
        db.prepare(
          `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, department, active, notes)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(employeeId, batch.client_id, formatPhoneNumber(row.employee_number_raw), fullName, row.job_title_raw, row.department_raw, `Created by import: ${batch.filename}`);
        employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employeeId);
        employeesCreated += 1;
      }

      for (const col of activeMap) {
        const cellValue = rawRow[col.source_column_header];
        if (cellValue === undefined || cellValue === null || String(cellValue).trim() === '') continue; // spec 13: blank isn't proof of anything - skip, don't create a false "Missing" record
        const parsed = parseSourceValue(cellValue);
        const masterTraining = repo.getMasterTraining(col.matched_training_id);

        // Rule 15 / duplicate handling: check before inserting whether this employee already
        // has a record for this training (from an earlier import or manual entry). Never skip
        // or overwrite - insert the new one too, then flag the whole group for human review.
        const hadExistingRecord = !!db
          .prepare('SELECT 1 FROM employee_training_records WHERE employee_id = ? AND training_id = ?')
          .get(employee.employee_id, col.matched_training_id);

        const recordId = uuidv4();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO employee_training_records
           (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
            completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'Pending Review', ?, ?, NULL, ?, ?)`
        ).run(
          recordId,
          batch.client_id,
          employee.employee_id,
          col.matched_training_id,
          masterTraining.training_name,
          col.source_column_header,
          parsed.completion_date,
          parsed.raw_source_value,
          `Import: ${batch.filename}`,
          now,
          now
        );
        if (hadExistingRecord) {
          const flagged = repo.flagDuplicatesIfAny(employee.employee_id, col.matched_training_id);
          if (flagged) duplicatesFlagged += 1;
        }
        const persisted = repo.recomputeAndPersistRecord(recordId);
        if (persisted && persisted.status === 'Pending Review') recordsNeedingReview += 1;
        recordsCreated += 1;
      }
    }
    db.prepare(
      'UPDATE import_batches SET status = ?, records_imported = ?, records_needing_review = ? WHERE batch_id = ?'
    ).run('committed', recordsCreated, recordsNeedingReview, req.params.batchId);
  });

  txn();

  res.json({
    batch_id: req.params.batchId,
    employees_created: employeesCreated,
    records_created: recordsCreated,
    duplicates_flagged: duplicatesFlagged,
    records_needing_review: recordsNeedingReview,
  });
});

router.delete('/batches/:batchId', requireAdmin, (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  db.prepare('UPDATE import_batches SET status = ? WHERE batch_id = ?').run('cancelled', req.params.batchId);
  res.status(204).end();
});

module.exports = router;
