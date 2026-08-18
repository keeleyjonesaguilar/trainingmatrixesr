const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const repo = require('../lib/repo');
const { parseSourceValue } = require('../lib/statusEngine');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Certificate of completion upload (Keeley's request): optional, attachable either when the
// record is created or later from the completed-trainings list. Stored on disk under
// DATA_DIR/certificates - same env var / same persisted disk as the SQLite file itself (see
// server/db.js), so uploads survive redeploys instead of living only in the ephemeral container.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const CERT_DIR = path.join(DATA_DIR, 'certificates');
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

const ALLOWED_CERT_EXTENSIONS = /\.(pdf|jpg|jpeg|png)$/i;

const certUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CERT_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${req.params.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_CERT_EXTENSIONS.test(file.originalname)) {
      return cb(new Error('Only PDF, JPG, or PNG files are allowed for a certificate upload'));
    }
    cb(null, true);
  },
});

router.get('/employee/:employeeId/training/:trainingId', (req, res) => {
  res.json(repo.listRecordsForEmployee(req.params.employeeId, req.params.trainingId));
});

// Manual add/correct of a training record (spec section 9). Preserves whatever original
// wording/date is supplied rather than overwriting silently - each save is a new row unless
// record_id is passed to update an existing one, so history isn't lost (spec section 12).
router.post('/', requireAdmin, (req, res) => {
  const {
    record_id, // if present, update in place; otherwise insert
    client_id,
    employee_id,
    training_id,
    original_client_training_name = null,
    completion_date = null,
    source_expiration_date = null,
    raw_source_value = null,
    source = 'Manual Entry',
    notes = null,
  } = req.body;

  if (!client_id || !employee_id || !training_id) {
    return res.status(400).json({ error: 'client_id, employee_id, training_id are required' });
  }
  const masterTraining = repo.getMasterTraining(training_id);
  if (!masterTraining) return res.status(400).json({ error: 'training_id does not exist in Master Trainings' });

  // If a raw value was given (e.g. "YES", "NO", a date) and no explicit completion_date,
  // interpret it the same way an import would - never fabricate a date ourselves.
  let finalCompletionDate = completion_date;
  let finalRawValue = raw_source_value;
  if (!completion_date && raw_source_value) {
    const parsed = parseSourceValue(raw_source_value);
    finalCompletionDate = parsed.completion_date;
    finalRawValue = parsed.raw_source_value;
  }

  const id = record_id || uuidv4();
  const existing = record_id ? db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(record_id) : null;
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE employee_training_records
       SET original_client_training_name=?, completion_date=?, source_expiration_date=?, raw_source_value=?, source=?, notes=?, updated_at=?
       WHERE record_id=?`
    ).run(
      original_client_training_name ?? existing.original_client_training_name,
      finalCompletionDate ?? existing.completion_date,
      source_expiration_date ?? existing.source_expiration_date,
      finalRawValue ?? existing.raw_source_value,
      source ?? existing.source,
      notes ?? existing.notes,
      now,
      id
    );
  } else {
    // Rule 15 / duplicate handling: check before inserting whether this employee already has
    // a record for this training, so we know afterward whether to flag the group for review.
    const hadExistingRecord = !!db
      .prepare('SELECT 1 FROM employee_training_records WHERE employee_id = ? AND training_id = ?')
      .get(employee_id, training_id);

    db.prepare(
      `INSERT INTO employee_training_records
       (record_id, client_id, employee_id, training_id, original_training_name, original_client_training_name,
        completion_date, source_expiration_date, expiration_date, status, raw_source_value, source, notes,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'Pending Review', ?, ?, ?, ?, ?)`
    ).run(
      id,
      client_id,
      employee_id,
      training_id,
      masterTraining.training_name,
      original_client_training_name,
      finalCompletionDate,
      source_expiration_date,
      finalRawValue,
      source,
      notes,
      now,
      now
    );

    if (hadExistingRecord) repo.flagDuplicatesIfAny(employee_id, training_id);
  }

  const updated = repo.recomputeAndPersistRecord(id);
  res.status(existing ? 200 : 201).json(updated);
});

// Duplicate resolution (Rule 15 / spec sections 18, 33): nothing is ever deleted - this just
// marks which record in a duplicate group is the active/current one. The rest stay visible in
// history but stop competing for "latest" in the matrix/dashboard/employee detail.
router.put('/:id/resolve-duplicate', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const updated = repo.resolveDuplicateGroup(req.params.id);
  res.json(updated);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  if (existing.certificate_path && fs.existsSync(existing.certificate_path)) {
    fs.unlink(existing.certificate_path, () => {});
  }
  db.prepare('DELETE FROM employee_training_records WHERE record_id = ?').run(req.params.id);
  res.status(204).end();
});

// Attach/replace the certificate of completion for a record. Optional at creation time (the
// completion form uploads here right after saving the record) and available any time after,
// from the Completed Trainings list on Employee Detail - so a certificate can always be added
// later even if it wasn't on hand when the training was first recorded.
router.post('/:id/certificate', requireAdmin, (req, res) => {
  certUpload.single('certificate')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const existing = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id);
    if (!existing) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Record not found' });
    }
    if (!req.file) return res.status(400).json({ error: 'A certificate file is required (field name "certificate")' });

    // Replacing an existing certificate - remove the old file so they don't pile up on disk.
    if (existing.certificate_path && existing.certificate_path !== req.file.path && fs.existsSync(existing.certificate_path)) {
      fs.unlink(existing.certificate_path, () => {});
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE employee_training_records
       SET certificate_filename = ?, certificate_path = ?, certificate_uploaded_at = ?, updated_at = ?
       WHERE record_id = ?`
    ).run(req.file.originalname, req.file.path, now, now, req.params.id);

    res.json(db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id));
  });
});

// Download/view the certificate on file for a record. Any authenticated user can view one
// (view-only accounts can still see certificates - requireAdmin only gates the upload/change).
router.get('/:id/certificate', (req, res) => {
  const record = db.prepare('SELECT * FROM employee_training_records WHERE record_id = ?').get(req.params.id);
  if (!record || !record.certificate_path) return res.status(404).json({ error: 'No certificate on file for this record' });
  if (!fs.existsSync(record.certificate_path)) return res.status(404).json({ error: 'Certificate file is missing on disk' });
  res.download(record.certificate_path, record.certificate_filename || 'certificate');
});

module.exports = router;
