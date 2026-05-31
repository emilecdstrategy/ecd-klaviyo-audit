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
