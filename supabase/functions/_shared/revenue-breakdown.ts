/** Revenue breakdown stored on account_snapshot.revenue_breakdown */
export type RevenueBreakdown = {
  total_store_revenue: number | null;
  attributed_revenue: number;
  campaign_revenue: number;
  flow_revenue: number;
  email_revenue: number;
  sms_revenue: number;
  timeframe: "last_30_days";
};

type ValuesReportRow = {
  groupings?: {
    send_channel?: string;
  };
  statistics?: {
    conversion_value?: number;
  };
};

function sumConversionValue(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const raw of rows) {
    const row = raw as ValuesReportRow;
    total += Number(row?.statistics?.conversion_value ?? 0) || 0;
  }
  return total;
}

function sumConversionValueByChannel(rows: unknown): { email: number; sms: number; other: number } {
  const out = { email: 0, sms: 0, other: 0 };
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = raw as ValuesReportRow;
    const value = Number(row?.statistics?.conversion_value ?? 0) || 0;
    if (value <= 0) continue;
    const channel = String(row?.groupings?.send_channel ?? "").toLowerCase();
    if (channel === "email") out.email += value;
    else if (channel === "sms") out.sms += value;
    else out.other += value;
  }
  return out;
}

/** Build revenue breakdown from campaign/flow values report rows. */
export function buildRevenueBreakdown(params: {
  totalStoreRevenue: number | null;
  campaignRowsAllChannels: unknown;
  flowRows: unknown;
  timeframe?: "last_30_days";
}): RevenueBreakdown {
  const campaignRevenue = sumConversionValue(params.campaignRowsAllChannels);
  const flowRevenue = sumConversionValue(params.flowRows);
  const campaignByChannel = sumConversionValueByChannel(params.campaignRowsAllChannels);
  const flowByChannel = sumConversionValueByChannel(params.flowRows);
  const emailRevenue = campaignByChannel.email + flowByChannel.email;
  const smsRevenue = campaignByChannel.sms + flowByChannel.sms;
  const attributedRevenue = campaignRevenue + flowRevenue;

  return {
    total_store_revenue: params.totalStoreRevenue,
    attributed_revenue: attributedRevenue,
    campaign_revenue: campaignRevenue,
    flow_revenue: flowRevenue,
    email_revenue: emailRevenue,
    sms_revenue: smsRevenue,
    timeframe: params.timeframe ?? "last_30_days",
  };
}
