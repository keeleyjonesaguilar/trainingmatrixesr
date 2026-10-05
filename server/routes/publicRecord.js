// Public, read-only employee training record behind each employee's QR code (Keeley's request,
// 2026-09-30) - mounted at /api/public-record WITHOUT requireAuth. The token in the link is the
// only key (server/lib/employeeRecordCard.js); no contact details are ever returned.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { dbGet } = require('../db');
const { publicRecord, publicCertificateRecord, publicDocument } = require('../lib/employeeRecordCard');
const { sendRecordCertificate } = require('../lib/recordCertificates');

const router = express.Router();
const LOGO_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

router.get('/:token', async (req, res) => {
  const record = await publicRecord(req.params.token);
  if (!record) return res.status(404).json({ error: "This training record link isn't valid (it may have been reset)." });
  res.set('Cache-Control', 'no-store');
  res.json(record);
});

// The employee's company logo, for the record page header.
router.get('/:token/logo', async (req, res) => {
  const row = await dbGet(
    'SELECT cl.logo_data FROM employees e JOIN client_logos cl ON cl.client_id = e.client_id WHERE e.record_token = ?',
    [String(req.params.token || '')]
  );
  const match = LOGO_PATTERN.exec(row?.logo_data || '');
  if (!match) return res.status(404).end();
  res.set('Content-Type', match[1]);
  res.send(Buffer.from(match[2], 'base64'));
});

// A training's ESR certificate, opened in the browser (Keeley's request, 2026-10-05).
router.get('/:token/certificates/:recordId', async (req, res) => {
  const record = await publicCertificateRecord(req.params.token, req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Certificate not found.' });
  res.set('Cache-Control', 'no-store');
  return sendRecordCertificate(res, record, { inline: true });
});

// A card filed under one of their trainings (OSHA, AHA...), opened in the browser.
router.get('/:token/documents/:documentId', async (req, res) => {
  const document = await publicDocument(req.params.token, req.params.documentId);
  if (!document || !fs.existsSync(document.file_path)) return res.status(404).json({ error: 'Document not found.' });
  res.set('Cache-Control', 'no-store');
  res.attachment(document.filename);
  res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  return res.sendFile(path.resolve(document.file_path));
});

module.exports = router;
