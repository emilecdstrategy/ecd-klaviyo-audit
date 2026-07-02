import type { Proposal, ProposalDisplayStatus } from './types';

export const PROPOSAL_STATUS_LABELS: Record<ProposalDisplayStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  won: 'Won',
  lost: 'Lost',
  expired: 'Expired',
};

/**
 * Display status for a proposal. 'expired' is derived from valid_until and is
 * never written to the database, so extending validity un-expires a proposal.
 */
export function deriveProposalStatus(
  proposal: Pick<Proposal, 'status' | 'valid_until'>,
  now: Date = new Date(),
): ProposalDisplayStatus {
  if (
    (proposal.status === 'sent' || proposal.status === 'viewed') &&
    proposal.valid_until
  ) {
    const validUntil = new Date(`${proposal.valid_until}T23:59:59`);
    if (Number.isFinite(validUntil.getTime()) && validUntil < now) {
      return 'expired';
    }
  }
  return proposal.status;
}

/** Open proposals count toward pipeline value. */
export function isProposalOpen(proposal: Pick<Proposal, 'status' | 'valid_until'>): boolean {
  const status = deriveProposalStatus(proposal);
  return status === 'sent' || status === 'viewed';
}
