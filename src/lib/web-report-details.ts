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

export type WebViewportTag = 'desktop' | 'mobile' | 'both';

export type WebFinding = {
  text: string;
  recommendation: string;
  viewport: WebViewportTag;
  /** Legacy single pin (kept for backward compat). Prefer `highlights`. */
  highlight?: WebHighlight | null;
  /** One pin per screenshot this finding is visible on (e.g. desktop AND mobile),
   * each carrying its own snapshot_id + coordinates. */
  highlights?: WebHighlight[];
  hidden?: boolean;
};

/** All pins for a finding, combining the new `highlights` array with the legacy
 * single `highlight`, de-duplicated by snapshot_id. */
export function findingHighlights(f: WebFinding): WebHighlight[] {
  const out: WebHighlight[] = [];
  const seen = new Set<string>();
  for (const h of [...(f.highlights ?? []), ...(f.highlight ? [f.highlight] : [])]) {
    if (!h || seen.has(h.snapshot_id)) continue;
    seen.add(h.snapshot_id);
    out.push(h);
  }
  return out;
}

export type WebAfterMarker = { index: number; x: number; y: number; w: number; h: number };

export type WebAfterImage = {
  url: string;
  generated_at: string;
  /** Numbered pins for the After image, carrying the SAME finding numbers as
   * the Before pins. Written by the HTML engine; percentages of the image. */
  markers?: WebAfterMarker[];
  /** Which engine produced it: 'html' edits the real page, 'gemini_fallback'
   * repaints the screenshot. Shown as an editor-only badge so a result being
   * judged is always attributable. */
  engine?: 'html' | 'gemini_fallback';
  applied_count?: number;
  total_count?: number;
  /** Why nothing was published, when `url` is empty. `photo_integrity_failed`
   * means the generator damaged the client's own photos on every attempt and
   * the hard gate refused to publish the result. */
  error?: string;
};

export type WebSectionDetail = {
  pros: string[];
  findings: WebFinding[];
  primary_snapshot_id: string | null;
  after_images: { desktop?: WebAfterImage; mobile?: WebAfterImage };
};

export type WebAnalyticsMetric = { key: string; commentary: string; recommendation: string };
/** One shippable opportunity read out of the order data: what the numbers show,
 * and the thing to do about it. */
export type WebAnalyticsPlay = {
  title: string;
  /** Kept out of the client's report while staying in the data, the same way a
   *  page finding or a roadmap row is hidden rather than deleted. */
  hidden?: boolean;
  insight: string;
  /** The work, as bullets. Older audits stored one sentence; parsed into [one]. */
  action_steps: string[];
  /** Exact product titles this play is about, matched against the basket data. */
  products: string[];
  metric: string;
  window: string;
};

/** A product as it appears in the order data, with what a card needs to show it. */
export type BasketProduct = {
  title: string;
  revenue: number;
  units?: number;
  orders?: number;
  handle?: string | null;
  image?: string | null;
  unit_price?: number | null;
};

/** The live product page for a card. Handles carry ® and ™ on some stores, and
 * those MUST be percent-encoded: lazyleaf's raw handle 404s while the encoded
 * one returns 200. */
export function productUrl(base: string | null | undefined, handle: string | null | undefined): string | null {
  const b = (base ?? '').replace(/\/$/, '');
  const h = (handle ?? '').trim();
  if (!b || !h) return null;
  return `${b}/products/${encodeURIComponent(h)}`;
}
export type WebAnalyticsDetail = { timeframe_key: string; plays: WebAnalyticsPlay[]; metrics: WebAnalyticsMetric[] };

export type WebRoadmapRow = {
  priority: 'high' | 'medium' | 'low';
  item_name: string;
  template_slug: string | null;
  note: string;
  /** Implementation effort in half-hour steps. The setup price is this times
   *  the roadmap's hourly rate; the client sees the money, never the hours. */
  setup_hours: number | null;
  /** Pre-hours audits priced setup as free text from the catalogue. Kept so an
   *  old report still shows what it always showed. */
  setup_cost_label: string;
  ongoing_cost_label: string;
  hidden?: boolean;
  /** Unticked in the investment summary. Absent means counted, so rows written
   *  before the summary existed are all in by default. */
  investment_included?: boolean;
};

/** The roadmap section as stored, including the rate its prices were built at. */
export type WebRoadmapDetail = {
  rows: WebRoadmapRow[];
  /** Stamped when the roadmap is generated so raising the platform rate never
   *  reprices an audit a client has already read. */
  hourly_rate: number | null;
  investment_title: string;
  investment_subtitle: string;
  investment_hidden: boolean;
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
        const parseHl = (raw: unknown): WebHighlight | null => {
          const hlRaw = raw ? asRecord(raw) : null;
          return hlRaw && asString(hlRaw.snapshot_id)
            ? {
                snapshot_id: asString(hlRaw.snapshot_id),
                x: asNumber(hlRaw.x),
                y: asNumber(hlRaw.y),
                w: asNumber(hlRaw.w),
                h: asNumber(hlRaw.h),
                label: asString(hlRaw.label),
              }
            : null;
        };
        const highlight = parseHl(rec.highlight);
        const highlights: WebHighlight[] = [];
        const seenSnap = new Set<string>();
        for (const raw of [...(Array.isArray(rec.highlights) ? rec.highlights : []), rec.highlight]) {
          const hl = parseHl(raw);
          if (hl && !seenSnap.has(hl.snapshot_id)) {
            seenSnap.add(hl.snapshot_id);
            highlights.push(hl);
          }
        }
        const vpRaw = asString(rec.viewport).toLowerCase();
        const viewport: WebViewportTag =
          vpRaw === 'desktop' || vpRaw === 'mobile' ? vpRaw : 'both';
        return {
          text: asString(rec.text),
          recommendation: asString(rec.recommendation),
          viewport,
          highlight,
          highlights,
          hidden: rec.hidden === true,
        };
      })
    : [];
  const afterRaw = asRecord(web.after_images);
  const parseAfter = (v: unknown): WebAfterImage | undefined => {
    const rec = asRecord(v);
    const url = asString(rec.url);
    const error = asString(rec.error);
    // Keep a withheld entry (no url) when it carries a reason, so the editor can
    // explain the gap instead of the report silently showing the Before alone.
    if (!url && !error) return undefined;
    const engine = asString(rec.engine);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const markers = (Array.isArray(rec.markers) ? rec.markers : [])
      .map((m) => {
        const r = asRecord(m);
        const vals = [r.index, r.x, r.y, r.w, r.h].map(Number);
        return vals.every((v) => Number.isFinite(v))
          ? { index: vals[0], x: vals[1], y: vals[2], w: vals[3], h: vals[4] }
          : null;
      })
      .filter((m): m is WebAfterMarker => m !== null);
    return {
      url,
      generated_at: asString(rec.generated_at),
      engine: engine === 'html' || engine === 'gemini_fallback' ? engine : undefined,
      applied_count: num(rec.applied_count),
      total_count: num(rec.total_count),
      markers,
      error: error || undefined,
    };
  };
  const after_images: WebSectionDetail['after_images'] = {};
  const desktopAfter = parseAfter(afterRaw.desktop);
  const mobileAfter = parseAfter(afterRaw.mobile);
  if (desktopAfter) after_images.desktop = desktopAfter;
  if (mobileAfter) after_images.mobile = mobileAfter;

  return { pros, findings, primary_snapshot_id: asString(web.primary_snapshot_id) || null, after_images };
}

export function parseWebAnalyticsDetail(sectionDetails: unknown): WebAnalyticsDetail | null {
  const a = asRecord(asRecord(sectionDetails).web_analytics);
  if (!a.metrics && !a.plays && !a.timeframe_key) return null;
  const metrics: WebAnalyticsMetric[] = Array.isArray(a.metrics)
    ? a.metrics.map((m) => {
        const rec = asRecord(m);
        return { key: asString(rec.key), commentary: asString(rec.commentary), recommendation: asString(rec.recommendation) };
      })
    : [];
  const plays: WebAnalyticsPlay[] = Array.isArray(a.plays)
    ? a.plays
        .map((p) => {
          const rec = asRecord(p);
          const rawSteps = Array.isArray(rec.action_steps) ? rec.action_steps : [];
          const steps = rawSteps.map((s) => asString(s)).filter(Boolean);
          const legacy = asString(rec.action);
          const play: WebAnalyticsPlay = {
            title: asString(rec.title),
            insight: asString(rec.insight),
            action_steps: steps.length > 0 ? steps : (legacy ? [legacy] : []),
            products: Array.isArray(rec.products) ? rec.products.map((t) => asString(t)).filter(Boolean) : [],
            metric: asString(rec.metric),
            window: asString(rec.window),
            hidden: rec.hidden === true,
          };
          // A play added by hand IS empty: it is the row someone just created,
          // and it arrives with one blank step slot. The old check ran after
          // blank steps had been stripped, so it saw nothing at all and deleted
          // the row on the next read: the button appeared to do nothing while
          // quietly saving a play that could never come back. The blank slot is
          // the tell, and the model can never produce one, because the edge
          // function requires a title, an insight and a step before a play is
          // stored at all.
          const empty = !play.title && !play.insight && !play.metric && play.action_steps.length === 0;
          return empty && rawSteps.length === 0 ? null : play;
        })
        .filter((p): p is WebAnalyticsPlay => p !== null)
    : [];
  return { timeframe_key: asString(a.timeframe_key) || '30d_vs_prior_30d', plays, metrics };
}

/** Normalised for matching: trademark marks and punctuation gone, single
 *  spaces, lower case. */
function matchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[®™©]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The distinctive part of a product title.
 *
 *  Catalog titles carry a brand or collection after a pipe, as in
 *  "Mega Pazzaz™ Red Portulaca | Creekside Champions™", and anyone writing a
 *  sentence drops it along with the trademark marks. Matching on the head is
 *  what actually finds the product the sentence is about. */
function titleHead(title: string): string {
  return matchKey(title.split('|')[0] ?? title);
}

/**
 * The products a play names in its own text.
 *
 * A play is told to list the products it discusses so the report can show their
 * real photo, price and link. When it names them in a step and leaves the list
 * empty, the reader gets a recommendation about two products and no way to see
 * them. This finds them instead of asking again.
 *
 * It can only ever return products that are already in the order data, so it
 * cannot invent one. Short or single-word heads are skipped, because those
 * match by accident.
 */
export function productsNamedIn(text: string, catalog: BasketProduct[]): BasketProduct[] {
  const haystack = matchKey(text);
  if (!haystack) return [];
  const found: BasketProduct[] = [];
  for (const product of catalog) {
    const head = titleHead(product.title);
    if (head.length < 10 || head.split(' ').length < 2) continue;
    if (haystack.includes(head)) { found.push(product); continue; }
    // A long manufacturer title is never written out in full: "DEWALT DCD130T1
    // 60V MAX Mixer/Drill With E-Clutch" gets typed as "the DEWALT DCD130T1
    // Mixer Drill", which drops words from the middle and defeats a substring
    // match. A model number is distinctive enough to stand for the whole title
    // on its own, and short numeric fragments like "60v" or "3" are not.
    const modelNumber = head
      .split(' ')
      .find((token) => token.length >= 6 && /[0-9]/.test(token) && /[a-z]/.test(token));
    if (modelNumber && haystack.includes(modelNumber)) found.push(product);
  }
  return found;
}

/**
 * Is this play actually about specific products?
 *
 * "Pair the adapters with the augers they fit" is: every step names a product
 * and the products are the mechanism. "Raise the free shipping bar" is not,
 * even though one of its three steps mentions an item as an illustration, and
 * neither is a play about the add-to-cart step that happens to name two pages
 * where a generic change should go. Showing cards on those reads as though the
 * play were about the products, which sends the reader looking for a point that
 * is not being made.
 *
 * The separator is how central the products are: a play whose subject is its
 * products names them in most of its steps, or in its title. One passing
 * mention in one step of three does not.
 */
export function playIsAboutProducts(
  play: { title: string; insight: string; action_steps: string[] },
  catalog: BasketProduct[],
): boolean {
  if (catalog.length === 0) return false;
  // Named in the headline: unambiguous.
  if (productsNamedIn([play.title, play.insight].join(' \n '), catalog).length > 0) return true;
  const steps = play.action_steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) return false;
  const naming = steps.filter((step) => productsNamedIn(step, catalog).length > 0).length;
  return naming * 2 >= steps.length;
}

export function parseWebRoadmap(sectionDetails: unknown): WebRoadmapRow[] {
  return parseWebRoadmapDetail(sectionDetails).rows;
}

export function parseWebRoadmapDetail(sectionDetails: unknown): WebRoadmapDetail {
  const r = asRecord(asRecord(sectionDetails).web_roadmap);
  const rawRate = Number(r.hourly_rate);
  const rows: WebRoadmapRow[] = Array.isArray(r.rows)
    ? r.rows.map((row) => {
        const rec = asRecord(row);
        const priority = (['high', 'medium', 'low'] as const).includes(rec.priority as never)
          ? (rec.priority as WebRoadmapRow['priority'])
          : 'medium';
        const hours = Number(rec.setup_hours);
        return {
          priority,
          item_name: asString(rec.item_name),
          template_slug: rec.template_slug ? asString(rec.template_slug) : null,
          note: asString(rec.note),
          setup_hours: Number.isFinite(hours) && hours > 0 ? hours : null,
          setup_cost_label: asString(rec.setup_cost_label) || 'Custom / TBD',
          ongoing_cost_label: asString(rec.ongoing_cost_label) || '—',
          hidden: rec.hidden === true,
          investment_included: rec.investment_included !== false,
        };
      })
    : [];
  return {
    rows,
    hourly_rate: Number.isFinite(rawRate) && rawRate > 0 ? rawRate : null,
    investment_title: asString(r.investment_title) || 'Investment Summary',
    investment_subtitle: asString(r.investment_subtitle),
    investment_hidden: r.investment_hidden === true,
  };
}

// --- Analytics computed (from shopify_data_snapshots orders_rollup) ---------

export type PeriodMetrics = {
  order_count: number;
  gross_revenue: number;
  aov: number;
  returning_customer_rate: number;
};

export type SessionFunnel = {
  sessions: number;
  cart_additions: number;
  reached_checkout: number;
  completed_checkout: number;
  /** Whole-number percent, already converted from the fraction Shopify sends. */
  conversion_rate: number | null;
};

export type OrdersRollup = {
  current?: PeriodMetrics;
  /** Null when the fetch never reached the prior period, so the report shows no
   *  comparison rather than a zero baseline. */
  previous?: PeriodMetrics | null;
  /** Days the current figures actually cover. Below 30 when the order fetch hit
   *  its page cap on a high-volume store. */
  period_days?: number;
  period_truncated?: boolean;
  deltas?: Record<string, number | null>;
  /** Traffic and the checkout funnel, from Shopify's own analytics. Null, or
   *  carrying an error, when the store's app has no read_analytics scope: the
   *  report then shows the four order-based figures and no traffic at all,
   *  rather than empty cards. */
  sessions?: {
    period_days: number;
    current: SessionFunnel;
    previous?: SessionFunnel | null;
    devices?: Array<{ device: string; sessions: number; conversion_rate: number | null }>;
    error?: string;
  } | null;
  top_products?: Array<{ title: string; revenue: number }>;
  channels?: Array<{ name: string; revenue: number; orders: number }>;
  currency?: string | null;
  returning_customer_rate_available?: boolean;
  /** How the repeat rate was measured. Both periods share the lookback, which is
   *  what makes the comparison honest; see repeat-rate.ts. */
  repeat_basis?: {
    lookback_days?: number;
    current_identified_orders?: number;
    previous_identified_orders?: number;
  } | null;
  /** Customer-facing origin, for linking product cards to live pages. */
  store_url_base?: string | null;
  /** Basket shape over an adaptive window; see analyzeBaskets in web_fetch_snapshot. */
  basket?: {
    window_days?: number;
    orders_analyzed?: number;
    confident?: boolean;
    units_per_order?: number;
    single_item_order_share?: number | null;
    frequent_pairs?: Array<{ products: string[]; orders: number; revenue: number }>;
  /** Full records for the products named in frequent_pairs, so a pairing play
   *  can show the two products it is about. They are not part of the best
   *  seller wall, which stays ranked on top_products. */
  pair_products?: BasketProduct[];
    /** Ranked by revenue. `top_products_by_units` is the old key for the same
     * list, kept for snapshots stored before the rename. */
    top_products?: BasketProduct[];
    top_products_by_units?: BasketProduct[];
    distinct_products_sold?: number;
    order_history_limited?: boolean;
    /** The window is short because the store filled our 2000-order page cap,
     *  which is a fact about volume, not a missing permission. */
    orders_truncated?: boolean;
    top_product_revenue_share?: number;
    top3_product_revenue_share?: number;
    discounted_order_share?: number;
    avg_discount_depth_pct?: number;
    order_value_percentiles?: { p25?: number; p50?: number; p75?: number; p90?: number };
  };
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
