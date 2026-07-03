// TEMPORARY: Proposals is still being tested and shouldn't be visible to the
// rest of the team yet. Remove this gate (and its call sites) once it's ready
// for a wider rollout.
const PROPOSALS_BETA_EMAIL = 'emil@ecdigitalstrategy.com';

export function canSeeProposalsBeta(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === PROPOSALS_BETA_EMAIL;
}
