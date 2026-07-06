// TEMPORARY: Proposals is still being tested and shouldn't be visible to the
// rest of the team yet. Remove this gate (and its call sites) once it's ready
// for a wider rollout.
const PROPOSALS_BETA_EMAILS = new Set([
  'emil@ecdigitalstrategy.com',
  'zak@ecdigitalstrategy.com',
  'xiomara@ecdigitalstrategy.com',
]);

export function canSeeProposalsBeta(email: string | null | undefined): boolean {
  return PROPOSALS_BETA_EMAILS.has((email ?? '').trim().toLowerCase());
}
