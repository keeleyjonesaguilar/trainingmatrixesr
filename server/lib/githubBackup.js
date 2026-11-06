// Pushes the daily backup to a private GitHub repo, off Render entirely - a second, independent
// place to recover from if the Render account/service/persistent disk itself were ever lost, not
// just a second file next to the first (Keeley's request, 2026-09-16: "I can't lose data from
// this application... it stores training files for OSHA compliance").
//
// Deliberately overwrites the SAME file on every run rather than writing a new dated file each
// time - GitHub's own commit history on that one file already gives full day-by-day recoverability
// (every past version is a `git log` / "History" click away), which is a stronger guarantee than
// this app's own 2-generation local rotation, at no extra code.
//
// Requires GITHUB_BACKUP_TOKEN (a fine-grained PAT, Contents: Read and write, scoped to only the
// one backup repo) and GITHUB_BACKUP_REPO ("owner/repo") in the environment. Silently does nothing
// if either is unset, so this is opt-in and never blocks the local backup from completing.
const fs = require('fs');
const https = require('https');
const { Readable, pipeline } = require('stream');

const BACKUP_FILE_PATH = 'training-matrix-backup-latest.json';
const PUSH_TIMEOUT_MS = 10 * 60 * 1000;

// Reads the backup file a piece at a time and yields the PUT request body
// {"message":..,"sha":..,"content":"<base64 of the file>"} - the same body the Contents API has
// always received, but never more than one ~200 KB piece of it in memory at once. Pieces are
// kept to whole multiples of 3 bytes so each one base64-encodes on its own with no padding in the
// middle; the leftover 1-2 bytes carry into the next piece.
async function* uploadBody(filePath, head, tail) {
  yield head;
  let carry = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 3 * 64 * 1024 })) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const whole = buf.length - (buf.length % 3);
    if (whole) yield Buffer.from(buf.subarray(0, whole).toString('base64'), 'latin1');
    carry = Buffer.from(buf.subarray(whole));
  }
  if (carry.length) yield Buffer.from(carry.toString('base64'), 'latin1');
  yield tail;
}

// Pushes the backup file at `filePath`. Streams it from disk (see uploadBody) - the old version
// took the whole backup as one string and built a Buffer, a base64 copy and a JSON body copy of
// it all at once, which on 2026-11-06 pushed the 512 MB server over its memory limit.
async function pushBackupFileToGitHub(filePath, dumpedAt) {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const repo = process.env.GITHUB_BACKUP_REPO;
  if (!token || !repo) return { skipped: true };

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${BACKUP_FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'training-matrix-backup-scheduler',
  };

  // The Contents API needs the current file's sha to update it (not needed for the very first
  // push, when the file doesn't exist yet - a 404 here is expected and fine).
  // The "object" media type returns only the file's details (content left empty for files over
  // 1 MB), so this lookup never downloads yesterday's whole backup into memory.
  let sha;
  const getRes = await fetch(apiUrl, { headers: { ...headers, Accept: 'application/vnd.github.object+json' } });
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub backup lookup failed (${getRes.status}): ${(await getRes.text()).slice(0, 300)}`);
  }

  // The same compact JSON as the local copy. It used to be re-serialized pretty-printed for a
  // readable GitHub diff, but at ~25 MB GitHub doesn't render the diff anyway, and building a
  // second, larger copy doubled the backup's memory use (audit, 2026-10-01).
  const size = fs.statSync(filePath).size;
  const head = Buffer.from(
    `{"message":${JSON.stringify(`Backup ${dumpedAt}`)},${sha ? `"sha":${JSON.stringify(sha)},` : ''}"content":"`
  );
  const tail = Buffer.from('"}');
  const contentLength = head.length + 4 * Math.ceil(size / 3) + tail.length;

  await new Promise((resolve, reject) => {
    const req = https.request(
      apiUrl,
      { method: 'PUT', headers: { ...headers, 'Content-Length': contentLength } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (piece) => {
          if (text.length < 2000) text += piece;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`GitHub backup push failed (${res.statusCode}): ${text.slice(0, 300)}`));
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(PUSH_TIMEOUT_MS, () => req.destroy(new Error('GitHub backup push timed out')));
    req.on('error', reject);
    pipeline(Readable.from(uploadBody(filePath, head, tail)), req, (err) => {
      if (err) reject(err);
    });
  });
  return { skipped: false };
}

module.exports = { pushBackupFileToGitHub, uploadBody };
