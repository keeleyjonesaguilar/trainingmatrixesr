// What to tell the office after the class summary email to the trainer(s) (2026-10-12,
// server/lib/trainerSummary.js) - only when someone didn't get it. Null when everyone did.
export function trainerSummaryProblem(result) {
  if (!result || result.skipped) return null;
  if (result.error) return `${result.error} Use "Email Class Summary" on the session page to try again.`;
  const lines = [];
  if (result.missing?.length) lines.push(`No email on file for ${result.missing.join(', ')}, so they didn't get the class summary. Add an email to their profile, then use "Email Class Summary" on the session page.`);
  if (result.failed?.length) lines.push(`The class summary couldn't be sent to ${result.failed.join(', ')}. Use "Email Class Summary" on the session page to try again.`);
  return lines.length ? lines.join('\n\n') : null;
}
