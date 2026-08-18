const path = require('path');

// Same DATA_DIR convention as db.js, so both read the same env var and always agree.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

module.exports = { DATA_DIR };
