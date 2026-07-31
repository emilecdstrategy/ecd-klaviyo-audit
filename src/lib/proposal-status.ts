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

// ---------------------------------------------------------------------------
// Expiry
//
// One global window, set in Settings > Proposals ("Proposal valid for (days)").
// It is not per service line and not per template. The clock starts on the
// client's FIRST VIEW, so valid_until stays null until then, and a proposal that
// was never opened never expires.
//
// valid_until is a DATE, so the deadline is the END of that day. There is no
// meaningful time-of-day to show, and the hourly job that marks expired
// proposals lost compares the same way.

export type ProposalExpiry =
  | { state: 'not_started' }
  | { state: 'no_expiry' }
  | { state: 'active'; daysLeft: number; endOfDay: Date }
  | { state: 'expired'; daysAgo: number; endOfDay: Date };

/** End of the valid_until day, the actual cutoff. */
export function proposalExpiryMoment(validUntil: string | null | undefined): Date | null {
  if (!validUntil) return null;
  const d = new Date(`${validUntil}T23:59:59`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Calendar days between two moments, ignoring time of day. Comparing to
 * end-of-day instead would make "valid until 31 Aug", seen on 1 Aug, read as
 * "in 31 days" when the promise was 30. */
function calendarDayDiff(from: Date, to: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(to) - startOfDay(from)) / (24 * 60 * 60 * 1000));
}

export function describeProposalExpiry(
  proposal: Pick<Proposal, 'status' | 'valid_until'>,
  now: Date = new Date(),
): ProposalExpiry {
  // Closed proposals have no live countdown.
  if (proposal.status === 'won' || proposal.status === 'lost') return { state: 'no_expiry' };
  const endOfDay = proposalExpiryMoment(proposal.valid_until);
  // The client has not opened it, so the window has not begun.
  if (!endOfDay) return { state: 'not_started' };
  // Expiry lands at the end of the day, so once lapsed it is always at least
  // the following calendar day.
  if (endOfDay < now) {
    return { state: 'expired', daysAgo: Math.max(1, calendarDayDiff(endOfDay, now)), endOfDay };
  }
  return { state: 'active', daysLeft: Math.max(0, calendarDayDiff(now, endOfDay)), endOfDay };
}

/** Short label for the Expires column. */
export function proposalExpiryLabel(expiry: ProposalExpiry): string {
  switch (expiry.state) {
    case 'not_started':
      return 'Starts when opened';
    case 'no_expiry':
      return '—';
    case 'expired':
      return expiry.daysAgo === 1 ? 'Expired yesterday' : `Expired ${expiry.daysAgo} days ago`;
    case 'active':
      if (expiry.daysLeft === 0) return 'Today';
      if (expiry.daysLeft === 1) return 'Tomorrow';
      return `in ${expiry.daysLeft} days`;
  }
}

/** Full sentence for the tooltip. States end-of-day rather than a fake time. */
export function proposalExpiryTooltip(expiry: ProposalExpiry, validDays: number): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  switch (expiry.state) {
    case 'not_started':
      return `The ${validDays}-day window starts when the client first opens the proposal, so there is no expiry date yet.`;
    case 'no_expiry':
      return 'This proposal is closed, so it no longer expires.';
    case 'expired':
      return `Expired at the end of ${fmt(expiry.endOfDay)}. Expired proposals are marked lost automatically.`;
    case 'active':
      return `Valid until the end of ${fmt(expiry.endOfDay)} (${validDays} days from the client's first view).`;
  }
}
