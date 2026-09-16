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
const BACKUP_FILE_PATH = 'training-matrix-backup-latest.json';

async function pushBackupToGitHub(dump) {
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
  let sha;
  const getRes = await fetch(apiUrl, { headers });
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub backup lookup failed (${getRes.status}): ${(await getRes.text()).slice(0, 300)}`);
  }

  // Pretty-printed (unlike the local copy) so GitHub's own diff view on the file's history is
  // actually readable, since that history is the whole point of pushing it here.
  const content = Buffer.from(JSON.stringify(dump, null, 2)).toString('base64');
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `Backup ${dump.dumped_at}`, content, sha }),
  });
  if (!putRes.ok) {
    throw new Error(`GitHub backup push failed (${putRes.status}): ${(await putRes.text()).slice(0, 300)}`);
  }
  return { skipped: false };
}

module.exports = { pushBackupToGitHub };
