// Parsers + types for the web-audit data stored in audit_sections.section_details
// by the web_finalize_analysis pipeline. Shared by the report view and editors.

export type WebHighlight = {
  snapshot_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

export type WebFinding = {
  text: string;
  recommendation: string;
  highlight?: WebHighlight | null;
  hidden?: boolean;
};

export type WebSectionDetail = {
  pros: string[];
  findings: WebFinding[];
  primary_snapshot_id: string | null;
};

export type WebAnalyticsMetric = { key: string; commentary: string; recommendation: string };
export type WebAnalyticsDetail = { timeframe_key: string; metrics: WebAnalyticsMetric[] };

export type WebRoadmapRow = {
  priority: 'high' | 'medium' | 'low';
  item_name: string;
  template_slug: string | null;
  note: string;
  setup_cost_label: string;
  ongoing_cost_label: string;
  hidden?: boolean;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseWebSectionDetail(sectionDetails: unknown): WebSectionDetail {
  const web = asRecord(asRecord(sectionDetails).web);
  const pros = Array.isArray(web.pros) ? web.pros.map(asString).filter(Boolean) : [];
  const findings: WebFinding[] = Array.isArray(web.findings)
    ? web.findings.map((f) => {
        const rec = asRecord(f);
        const hlRaw = rec.highlight ? asRecord(rec.highlight) : null;
        const highlight: WebHighlight | null =
          hlRaw && asString(hlRaw.snapshot_id)
            ? {
                snapshot_id: asString(hlRaw.snapshot_id),
                x: asNumber(hlRaw.x),
                y: asNumber(hlRaw.y),
                w: asNumber(hlRaw.w),
                h: asNumber(hlRaw.h),
                label: asString(hlRaw.label),
              }
            : null;
        return {
          text: asString(rec.text),
          recommendation: asString(rec.recommendation),
          highlight,
          hidden: rec.hidden === true,
        };
      })
    : [];
  return { pros, findings, primary_snapshot_id: asString(web.primary_snapshot_id) || null };
}

export function parseWebAnalyticsDetail(sectionDetails: unknown): WebAnalyticsDetail | null {
  const a = asRecord(asRecord(sectionDetails).web_analytics);
  if (!a.metrics && !a.timeframe_key) return null;
  const metrics: WebAnalyticsMetric[] = Array.isArray(a.metrics)
    ? a.metrics.map((m) => {
        const rec = asRecord(m);
        return { key: asString(rec.key), commentary: asString(rec.commentary), recommendation: asString(rec.recommendation) };
      })
    : [];
  return { timeframe_key: asString(a.timeframe_key) || '30d_vs_prior_30d', metrics };
}

export function parseWebRoadmap(sectionDetails: unknown): WebRoadmapRow[] {
  const r = asRecord(asRecord(sectionDetails).web_roadmap);
  if (!Array.isArray(r.rows)) return [];
  return r.rows.map((row) => {
    const rec = asRecord(row);
    const priority = (['high', 'medium', 'low'] as const).includes(rec.priority as never)
      ? (rec.priority as WebRoadmapRow['priority'])
      : 'medium';
    return {
      priority,
      item_name: asString(rec.item_name),
      template_slug: rec.template_slug ? asString(rec.template_slug) : null,
      note: asString(rec.note),
      setup_cost_label: asString(rec.setup_cost_label) || 'Custom / TBD',
      ongoing_cost_label: asString(rec.ongoing_cost_label) || '—',
      hidden: rec.hidden === true,
    };
  });
}

// --- Analytics computed (from shopify_data_snapshots orders_rollup) ---------

export type PeriodMetrics = {
  order_count: number;
  gross_revenue: number;
  aov: number;
  returning_customer_rate: number;
};

export type OrdersRollup = {
  current?: PeriodMetrics;
  previous?: PeriodMetrics;
  deltas?: Record<string, number | null>;
  top_products?: Array<{ title: string; revenue: number }>;
  channels?: Array<{ name: string; revenue: number; orders: number }>;
  currency?: string | null;
};

export const METRIC_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  aov: 'Average Order Value',
  returning_customer_rate: 'Returning Customer Rate',
  top_products: 'Top Products',
  sales_by_channel: 'Sales by Channel',
};

export function formatMoney(amount: number, currency?: string | null): string {
  const cur = currency && typeof currency === 'string' ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }
}

export function formatDelta(delta: number | null | undefined): { text: string; positive: boolean } | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  const positive = delta >= 0;
  return { text: `${positive ? '+' : ''}${delta}%`, positive };
}
