/** Klaviyo campaign-values-report row (grouped by campaign/message). */
type CampaignReportRow = {
  statistics?: {
    recipients?: number;
    revenue_per_recipient?: number;
    conversion_value?: number;
  };
};

/** Weighted average revenue per recipient across campaign report rows. */
export function computeCampaignRevenuePerRecipient(rows: unknown): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let totalRecipients = 0;
  let totalRevenue = 0;
  for (const raw of rows) {
    const row = raw as CampaignReportRow;
    const stats = row?.statistics ?? {};
    const recipients = Number(stats.recipients ?? 0) || 0;
    if (recipients <= 0) continue;
    const convValue = Number(stats.conversion_value ?? 0) || 0;
    const rpr = Number(stats.revenue_per_recipient ?? 0) || 0;
    totalRecipients += recipients;
    totalRevenue += convValue > 0 ? convValue : rpr * recipients;
  }
  if (totalRecipients <= 0) return null;
  return totalRevenue / totalRecipients;
}
