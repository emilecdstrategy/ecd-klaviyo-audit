/** Account-level deliverability from email campaign values reports */
export type DeliverabilitySnapshot = {
  timeframe: "last_30_days";
  open_rate: number | null;
  click_rate: number | null;
  bounce_rate: number | null;
  unsubscribe_rate: number | null;
  spam_complaint_rate: number | null;
  recipients: number;
};

type CampaignReportRow = {
  statistics?: {
    recipients?: number;
    open_rate?: number;
    click_rate?: number;
    bounce_rate?: number;
    unsubscribe_rate?: number;
    spam_complaint_rate?: number;
  };
};

function weightedRate(rows: unknown, field: keyof NonNullable<CampaignReportRow["statistics"]>): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let denom = 0;
  let num = 0;
  for (const raw of rows) {
    const row = raw as CampaignReportRow;
    const stats = row?.statistics ?? {};
    const recipients = Number(stats.recipients ?? 0) || 0;
    if (recipients <= 0) continue;
    const rate = Number(stats[field] ?? NaN);
    if (!Number.isFinite(rate)) continue;
    denom += recipients;
    num += rate * recipients;
  }
  if (denom <= 0) return null;
  return num / denom;
}

function totalRecipients(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const raw of rows) {
    const row = raw as CampaignReportRow;
    total += Number(row?.statistics?.recipients ?? 0) || 0;
  }
  return total;
}

/** Build deliverability snapshot from last_30_days email campaign report rows. */
export function buildDeliverabilitySnapshot(
  campaignRows: unknown,
  timeframe: "last_30_days" = "last_30_days",
): DeliverabilitySnapshot | null {
  const recipients = totalRecipients(campaignRows);
  if (recipients <= 0) return null;
  return {
    timeframe,
    open_rate: weightedRate(campaignRows, "open_rate"),
    click_rate: weightedRate(campaignRows, "click_rate"),
    bounce_rate: weightedRate(campaignRows, "bounce_rate"),
    unsubscribe_rate: weightedRate(campaignRows, "unsubscribe_rate"),
    spam_complaint_rate: weightedRate(campaignRows, "spam_complaint_rate"),
    recipients,
  };
}

/** Legacy helper for 90d bounce/spam only (account_snapshot bounce_rate_90d fields). */
export function extractBounceSpam(rowsIn: unknown): { bounce: number | null; spam: number | null } {
  return {
    bounce: weightedRate(rowsIn, "bounce_rate"),
    spam: weightedRate(rowsIn, "spam_complaint_rate"),
  };
}
