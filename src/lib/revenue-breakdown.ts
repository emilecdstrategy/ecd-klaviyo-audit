/** Revenue breakdown stored on account_snapshot.revenue_breakdown */
export type RevenueBreakdown = {
  total_store_revenue: number | null;
  attributed_revenue: number;
  campaign_revenue: number;
  flow_revenue: number;
  email_revenue: number;
  sms_revenue: number;
  timeframe: 'last_30_days';
};

export function formatRevenueBreakdownPct(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '—';
  return `${((part / whole) * 100).toFixed(2)}%`;
}

/** Compact label for UI: "12.71% of total store revenue · 42.35% of attributed" */
export function formatStoreRevenueContext(
  part: number,
  totalStore: number | null | undefined,
  attributed?: number | null | undefined,
): string | null {
  const parts: string[] = [];
  const storePct = totalStore && totalStore > 0 ? formatRevenueBreakdownPct(part, totalStore) : null;
  const attrPct = attributed && attributed > 0 ? formatRevenueBreakdownPct(part, attributed) : null;
  if (storePct && storePct !== '—') parts.push(`${storePct} of total store revenue`);
  if (attrPct && attrPct !== '—') parts.push(`${attrPct} of attributed`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
