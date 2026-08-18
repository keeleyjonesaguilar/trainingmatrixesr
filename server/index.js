const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

// Ensure DB + migrations run before routes attach.
require('./db');

// Auto-seed the Master Training Catalog on first boot (no-op if already populated), so a
// fresh cloud deploy works without needing shell/CLI access to run a seed command manually.
require('./seed/seed').seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Optional shared-password gate (spec explicitly deferred per-user logins, but this app
// holds employee compliance data and may end up on a public URL - if APP_USERNAME/APP_PASSWORD
// are set, every request must present them via HTTP Basic Auth. Leave both unset for local
// development with no prompt at all.
const GATE_USER = process.env.APP_USERNAME;
const GATE_PASS = process.env.APP_PASSWORD;
if (GATE_USER && GATE_PASS) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      const userOk = user && user.length === GATE_USER.length && crypto.timingSafeEqual(Buffer.from(user), Buffer.from(GATE_USER));
      const passOk = pass && pass.length === GATE_PASS.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(GATE_PASS));
      if (userOk && passOk) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Training Matrix"');
    res.status(401).send('Authentication required.');
  });
}

app.use('/api/clients', require('./routes/clients'));
app.use('/api/master-trainings', require('./routes/masterTrainings'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/training-requirements', require('./routes/trainingRequirements'));
app.use('/api/training-records', require('./routes/trainingRecords'));
app.use('/api/matrix', require('./routes/matrix'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/import', require('./routes/import'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve the built React frontend in production (client/dist), so the whole app is one process.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Centralized error handler so a thrown error returns JSON instead of crashing the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Training Matrix server listening on port ${PORT}`);
});
