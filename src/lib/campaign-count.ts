/** Max email campaigns fetched per Klaviyo snapshot (5 pages × 100). */
export const CAMPAIGN_SNAPSHOT_CAP = 500;

export function formatCampaignTotalDisplay(
  count: number,
  truncated?: boolean | null,
): string {
  if (truncated || count > CAMPAIGN_SNAPSHOT_CAP) return `${CAMPAIGN_SNAPSHOT_CAP}+`;
  return new Intl.NumberFormat('en-US').format(count);
}

export function campaignTotalSubtext(
  count: number,
  truncated?: boolean | null,
): string {
  if (truncated || count > CAMPAIGN_SNAPSHOT_CAP) {
    return 'email campaigns in account (partial scan)';
  }
  return 'email campaigns in account';
}
