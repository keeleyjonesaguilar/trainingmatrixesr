const QRCode = require('qrcode');

function publicSignInUrl(token) {
  const base = process.env.PUBLIC_APP_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}/s/${token}`;
}

function publicFeedbackUrl(token) {
  const base = process.env.PUBLIC_APP_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}/feedback/${token}`;
}

async function qrPngBuffer(token) {
  const url = publicSignInUrl(token);
  return QRCode.toBuffer(url, { type: 'png', width: 600, margin: 2 });
}

async function feedbackQrPngBuffer(token) {
  const url = publicFeedbackUrl(token);
  return QRCode.toBuffer(url, { type: 'png', width: 600, margin: 2 });
}

module.exports = { publicSignInUrl, qrPngBuffer, publicFeedbackUrl, feedbackQrPngBuffer };
