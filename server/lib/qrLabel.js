// A QR code PNG with a branded banner across the top saying what it's for - "SIGN-IN" (ESR
// green) or "FEEDBACK" (ESR gold) (Keeley's request, 2026-10-12: the two codes attached to the
// class summary email looked the same). The banners are pre-made 600 x 170 images in
// server/assets (Montserrat + Open Sans, the app's own theme), since the server has no fonts to
// draw text with.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BANNERS = {
  signin: path.join(__dirname, '..', 'assets', 'qr-banner-signin.png'),
  feedback: path.join(__dirname, '..', 'assets', 'qr-banner-feedback.png'),
};
const cache = {};

function banner(kind) {
  if (!cache[kind]) cache[kind] = PNG.sync.read(fs.readFileSync(BANNERS[kind]));
  return cache[kind];
}

// `qrBuffer` is a QR code PNG (lib/qr.js); `kind` is 'signin' or 'feedback'. Returns a new PNG
// buffer: the banner, then the code, centered on white.
function labeledQrPng(qrBuffer, kind) {
  const qr = PNG.sync.read(qrBuffer);
  const top = banner(kind);
  const out = new PNG({ width: Math.max(qr.width, top.width), height: top.height + qr.height });
  out.data.fill(255);
  PNG.bitblt(top, out, 0, 0, top.width, top.height, Math.floor((out.width - top.width) / 2), 0);
  PNG.bitblt(qr, out, 0, 0, qr.width, qr.height, Math.floor((out.width - qr.width) / 2), top.height);
  return PNG.sync.write(out);
}

module.exports = { labeledQrPng };
