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
const db = require('../db');
const repo = require('../lib/repo');
const { parseSourceValue } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');
const { formatPhoneNumber } = require('../lib/phone');
const { maybeGenerateCertificate } = require('../lib/recordCertificates');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const IDENTITY_COLUMN_PATTERNS = {
  client: [/^client(\s*name)?$/i, /^company(\s*name)?$/i],
  first_name: [/^(employee\s*)?first\s*name$/i],
  last_name: [/^(employee\s*)?last\s*name$/i],
  trainer: [/^trainer(\s*name)?$/i, /^instructor(\s*name)?$/i],
  employee_number: [/^emp(loyee)?\s*#?\s*(number|no|id)$/i, /^emp\s*#$/i, /^id$/i, /^(employee\s*)?phone(\s*number)?$/i, /^cell(\s*(phone|number))?$/i, /^mobile(\s*(phone|number))?$/i],
  // Single combined name column - kept for backward compatibility with older sheets built
  // before the First Name/Last Name split existed.
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
function matchTrainingColumn(header) {
  const norm = normalize(header);
  const alias = db.prepare('SELECT training_id FROM training_aliases WHERE alias_text = ?').get(norm);
  if (alias) return { training_id: alias.training_id, confidence: 'exact_alias' };

  const allTrainings = db.prepare('SELECT training_id, training_name FROM master_trainings').all();

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
router.get('/template.csv', (req, res) => {
  const trainings = repo.listMasterTrainings({ activeOnly: true });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Client', 'Employee First Name', 'Employee Last Name', 'Trainer', ...trainings.map((t) => t.training_name)];
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="training-import-template.csv"');
  res.send(header.map(esc).join(','));
});

// Step 1: upload + preview. Parses headers, auto-matches training columns and client names,
// stages every raw row (nothing from the source file is ever discarded).
router.post('/preview', requireAdmin, upload.single('file'), (req, res) => {
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

  if (!identityHeaders.client) {
    return res.status(400).json({ error: 'No "Client" column found - every row must specify which client it belongs to.' });
  }
  if (!identityHeaders.first_name && !identityHeaders.full_name) {
    return res.status(400).json({ error: 'No name column found - include "Employee First Name"/"Employee Last Name" (or a single "Full Name" column).' });
  }

  const batchId = uuidv4();
  db.prepare('INSERT INTO import_batches (batch_id, filename, imported_at, status, imported_by) VALUES (?, ?, ?, ?, ?)').run(
    batchId,
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

  // Existing clients loaded once, matched in memory - exact, case-insensitive, same rule
  // repo.findOrCreateClientByName uses elsewhere, just without the auto-create.
  const existingClients = db.prepare('SELECT client_id, client_name FROM clients WHERE is_internal = 0').all();
  const findClientId = (rawName) => {
    const trimmed = String(rawName || '').trim().toLowerCase();
    if (!trimmed) return null;
    const match = existingClients.find((c) => c.client_name.trim().toLowerCase() === trimmed);
    return match ? match.client_id : null;
  };

  const insertRow = db.prepare(
    `INSERT INTO import_staged_rows
     (staged_row_id, batch_id, employee_number_raw, full_name_raw, job_title_raw, department_raw,
      client_name_raw, resolved_client_id, first_name_raw, last_name_raw, trainer_name_raw, raw_row_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const txn = db.transaction((rows) => {
    for (const row of rows) {
      const firstName = identityHeaders.first_name ? (row[identityHeaders.first_name] || '').trim() : '';
      const lastName = identityHeaders.last_name ? (row[identityHeaders.last_name] || '').trim() : '';
      const fullName = identityHeaders.full_name
        ? (row[identityHeaders.full_name] || '').trim()
        : `${firstName} ${lastName}`.trim();
      const clientNameRaw = row[identityHeaders.client] || '';

      insertRow.run(
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
        JSON.stringify(row)
      );
    }
  });
  txn(records);

  const clientsNeedingReview = db
    .prepare(
      `SELECT client_name_raw, COUNT(*) AS row_count FROM import_staged_rows
       WHERE batch_id = ? AND resolved_client_id IS NULL AND client_name_raw != ''
       GROUP BY client_name_raw`
    )
    .all(batchId);

  res.status(201).json({
    batch_id: batchId,
    row_count: records.length,
    identity_columns_detected: identityHeaders,
    column_map: columnMapPreview,
    needs_review_count: columnMapPreview.filter((c) => c.resolution_status === 'needs_review').length,
    clients_needing_review: clientsNeedingReview,
  });
});

router.get('/batches/:batchId', (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const columnMap = db.prepare('SELECT * FROM import_column_map WHERE batch_id = ?').all(req.params.batchId);
  const rowCount = db.prepare('SELECT COUNT(*) AS n FROM import_staged_rows WHERE batch_id = ?').get(req.params.batchId).n;
  const clientsNeedingReview = db
    .prepare(
      `SELECT client_name_raw, COUNT(*) AS row_count FROM import_staged_rows
       WHERE batch_id = ? AND resolved_client_id IS NULL AND client_name_raw != ''
       GROUP BY client_name_raw`
    )
    .all(req.params.batchId);
  res.json({ batch, column_map: columnMap, row_count: rowCount, clients_needing_review: clientsNeedingReview });
});

// Step 2a: manually resolve an ambiguous/unmatched column. Remembers the choice as a new alias
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

// Step 2b: manually resolve a client name the automatch couldn't confidently match - either
// point every row that used this raw name at an existing client, or create a new one from it.
router.put('/batches/:batchId/resolve-client', requireAdmin, (req, res) => {
  const { client_name_raw, client_id, create_new } = req.body || {};
  if (!client_name_raw) return res.status(400).json({ error: 'client_name_raw is required' });

  let resolvedId = client_id;
  if (create_new) {
    resolvedId = repo.findOrCreateClientByName(client_name_raw);
  }
  if (!resolvedId) return res.status(400).json({ error: 'client_id or create_new is required' });
  const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(resolvedId);
  if (!client) return res.status(400).json({ error: 'client_id does not exist' });

  db.prepare('UPDATE import_staged_rows SET resolved_client_id = ? WHERE batch_id = ? AND client_name_raw = ?').run(
    resolvedId,
    req.params.batchId,
    client_name_raw
  );
  res.json({ client_name_raw, resolved_client_id: resolvedId, client });
});

// Step 3: commit. Every training column must be resolved (mapped or ignored), and every
// row's client must be resolved, before anything is ever written in.
router.post('/batches/:batchId/commit', requireAdmin, (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status !== 'pending_review') return res.status(409).json({ error: `Batch already ${batch.status}` });

  const columnMap = db.prepare('SELECT * FROM import_column_map WHERE batch_id = ?').all(req.params.batchId);
  const pending = columnMap.filter((c) => c.resolution_status === 'needs_review');
  if (pending.length) {
    return res.status(400).json({ error: 'Some columns still need review before committing', pending_columns: pending });
  }
  const unresolvedClientCount = db
    .prepare(`SELECT COUNT(*) AS n FROM import_staged_rows WHERE batch_id = ? AND resolved_client_id IS NULL AND client_name_raw != ''`)
    .get(req.params.batchId).n;
  if (unresolvedClientCount > 0) {
    return res.status(400).json({ error: 'Some rows still need their client resolved before committing' });
  }

  const activeMap = columnMap.filter((c) => c.resolution_status !== 'ignored' && c.matched_training_id);
  const stagedRows = db.prepare('SELECT * FROM import_staged_rows WHERE batch_id = ?').all(req.params.batchId);

  let employeesCreated = 0;
  let recordsCreated = 0;
  let recordsNeedingReview = 0;
  let rowsSkippedNoClient = 0;
  const createdRecordIds = [];

  const txn = db.transaction(() => {
    for (const row of stagedRows) {
      const rawRow = JSON.parse(row.raw_row_json);
      const fullName = (row.full_name_raw || '').trim();
      if (!fullName) continue; // can't create an employee with no identifying name - row preserved in raw_row_json regardless
      if (!row.resolved_client_id) { rowsSkippedNoClient += 1; continue; } // blank Client cell - nothing to attach this row to

      const clientId = row.resolved_client_id;
      const trainerEmployeeId = row.trainer_name_raw ? repo.findOrCreateTrainerEmployee(row.trainer_name_raw) : null;

      let employee = db
        .prepare('SELECT * FROM employees WHERE client_id = ? AND LOWER(full_name) = ? AND (employee_number = ? OR ? IS NULL)')
        .get(clientId, fullName.toLowerCase(), row.employee_number_raw, row.employee_number_raw);

      if (!employee) {
        const employeeId = uuidv4();
        db.prepare(
          `INSERT INTO employees (employee_id, client_id, employee_number, full_name, job_title, department, active, notes)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(employeeId, clientId, formatPhoneNumber(row.employee_number_raw), fullName, row.job_title_raw, row.department_raw, `Created by import: ${batch.filename}`);
        employee = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employeeId);
        employeesCreated += 1;
      }

      for (const col of activeMap) {
        const cellValue = rawRow[col.source_column_header];
        if (cellValue === undefined || cellValue === null || String(cellValue).trim() === '') continue; // spec 13: blank isn't proof of anything - skip, don't create a false "Missing" record
        const parsed = parseSourceValue(cellValue);
        const masterTraining = repo.getMasterTraining(col.matched_training_id);

        const recordId = uuidv4();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO employee_training_records
           (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
            completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
            trainer_employee_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'Pending Review', ?, ?, NULL, ?, ?, ?)`
        ).run(
          recordId,
          clientId,
          employee.employee_id,
          col.matched_training_id,
          masterTraining.training_name,
          col.source_column_header,
          parsed.completion_date,
          parsed.raw_source_value,
          `Import: ${batch.filename}`,
          trainerEmployeeId,
          now,
          now
        );
        const persisted = repo.recomputeAndPersistRecord(recordId);
        if (persisted && persisted.status === 'Pending Review') recordsNeedingReview += 1;
        recordsCreated += 1;
        createdRecordIds.push(recordId);
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
    records_needing_review: recordsNeedingReview,
    rows_skipped_no_client: rowsSkippedNoClient,
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

router.delete('/batches/:batchId', requireAdmin, (req, res) => {
  const batch = db.prepare('SELECT * FROM import_batches WHERE batch_id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  db.prepare('UPDATE import_batches SET status = ? WHERE batch_id = ?').run('cancelled', req.params.batchId);
  res.status(204).end();
});

module.exports = router;
