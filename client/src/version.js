// Bumped by hand at each meaningful milestone (a security/feature push worth marking, not every
// commit) - MAJOR.MINOR.PATCH, minor/patch zero-padded to 2 digits (v1.01.00, not semver's v1.1.0)
// for a more deliberate, release-note feel. Bumping this is step 1 of "cutting a version" - see
// server/scripts/backup-version.js for step 2 (the paired database snapshot) and tag the commit
// `git tag v1.01.00` as step 3, so the exact code for a version is always one `git checkout` away.
export const APP_VERSION = 'v1.01.00';
