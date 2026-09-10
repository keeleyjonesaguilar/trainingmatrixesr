// TOTP (RFC 6238) implementation for two-factor login, dependency-free (Node's built-in crypto
// only) to match server/lib/auth.js's existing approach - this app deliberately hand-rolls its
// own auth primitives instead of pulling in passport/jsonwebtoken/speakeasy-style libraries.
// Compatible with any standard authenticator app (Google/Microsoft Authenticator, Authy, 1Password, etc).
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    output += BASE32_ALPHABET[parseInt(bits.slice(bits.length - remainder).padEnd(5, '0'), 2)];
  }
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// 160-bit (20-byte) secret - the size every TOTP spec/authenticator app expects.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(keyBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', keyBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function totpAt(secretBase32, atMs) {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

// Accepts a code from one step before/after now (±30s), to tolerate clock drift between the
// server and the user's phone plus the few seconds it takes to type the code.
function verifyTotp(secretBase32, code, window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const codeBuffer = Buffer.from(String(code));
  const now = Date.now();
  for (let step = -window; step <= window; step++) {
    const candidate = Buffer.from(totpAt(secretBase32, now + step * STEP_SECONDS * 1000));
    if (crypto.timingSafeEqual(candidate, codeBuffer)) return true;
  }
  return false;
}

function otpauthUri({ secret, username, issuer = 'Safety Training Matrix' }) {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// One-time recovery codes shown to the user once, at enrollment, in case they lose their device.
function generateBackupCode() {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

module.exports = { generateSecret, verifyTotp, otpauthUri, generateBackupCode };
