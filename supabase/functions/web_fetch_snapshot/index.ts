import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, shopifyGraphql, mapShopifyErrorCode, exchangeClientCredentials } from "../_shared/shopify-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PERIOD_DAYS = 30;
const ORDERS_PAGE_SIZE = 250;
const ORDERS_MAX_PAGES = 8; // cap at 2000 orders across the fetched window
const TOP_PRODUCTS_SAMPLE = 100; // recent current-period orders sampled for top-products ranking
const DAY_MS = 24 * 60 * 60 * 1000;

/** Basket analysis (what sells together, how many items an order holds) needs
 * ORDERS, not days. lazyleaf takes 9 orders in 30 days, and "these two products
 * are bought together" off 9 orders is noise dressed as insight. So the KPI
 * comparison stays 30d vs prior 30d, while the basket stats widen to the
 * narrowest window that clears BASKET_MIN_ORDERS, and the window used is
 * reported alongside every number so nobody reads a 180-day pattern as this
 * month's behaviour. */
const BASKET_WINDOWS = [30, 90, 180];
const BASKET_MIN_ORDERS = 40;
/** Below this a co-occurrence is coincidence, not a pattern worth a bundle. */
const MIN_PAIR_ORDERS = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

type PeriodAgg = { order_count: number; gross_revenue: number; returning_orders: number };

function emptyPeriod(): PeriodAgg {
  return { order_count: 0, gross_revenue: 0, returning_orders: 0 };
}

function summarizePeriod(p: PeriodAgg) {
  return {
    order_count: p.order_count,
    gross_revenue: round2(p.gross_revenue),
    aov: p.order_count > 0 ? round2(p.gross_revenue / p.order_count) : 0,
    returning_customer_rate: p.order_count > 0 ? round2((p.returning_orders / p.order_count) * 100) : 0,
  };
}

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

function assertServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token && isServiceRoleAuthorization(token)) return;
  await getUserIdFromAuthorization(req);
}

/** Sample recent current-period orders' line items to rank top products by revenue. */
async function fetchTopProducts(shopDomain: string, token: string, currentSince: string) {
  try {
    const res = await shopifyGraphql(
      shopDomain,
      token,
      `query TopProducts($first: Int!, $query: String!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
          nodes {
            lineItems(first: 5) {
              nodes { title discountedTotalSet { shopMoney { amount } } }
            }
          }
        }
      }`,
      { first: TOP_PRODUCTS_SAMPLE, query: `created_at:>='${currentSince}'` },
    );
    if (!res.ok) return { items: [], sampled: 0, note: "unavailable" };
    const nodes: any[] = res.body?.data?.orders?.nodes ?? [];
    const byTitle = new Map<string, number>();
    for (const order of nodes) {
      for (const li of order?.lineItems?.nodes ?? []) {
        const title = String(li?.title ?? "").trim();
        if (!title) continue;
        const amount = Number.parseFloat(li?.discountedTotalSet?.shopMoney?.amount ?? "0");
        if (Number.isFinite(amount)) byTitle.set(title, (byTitle.get(title) ?? 0) + amount);
      }
    }
    const items = [...byTitle.entries()]
      .map(([title, revenue]) => ({ title, revenue: round2(revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    return { items, sampled: nodes.length, note: nodes.length >= TOP_PRODUCTS_SAMPLE ? "sample" : "full" };
  } catch {
    return { items: [], sampled: 0, note: "error" };
  }
}

/** Shopify's sourceName codes, as a merchant would name them. Anything not
 * listed is either an app (named via order.app) or a channel we pass through
 * as-is; a bare numeric id is an app we could not name, and "Other app" beats
 * printing the id at a client. */
const SOURCE_LABELS: Record<string, string> = {
  web: "Online store",
  pos: "Point of sale",
  shopify_draft_order: "Draft order",
  draft_order: "Draft order",
  iphone: "Shopify mobile",
  android: "Shopify mobile",
  shopify_payments_checkout: "Online store",
  subscription_contract: "Subscriptions",
};

export function channelLabel(sourceName: unknown, appName?: unknown): string {
  const src = String(sourceName ?? "").trim();
  const mapped = SOURCE_LABELS[src.toLowerCase()];
  if (mapped) return mapped;
  const app = String(appName ?? "").trim();
  if (app) return app;
  if (!src) return "Unknown";
  // An id, not a name. Never show it.
  if (/^d+$/.test(src)) return "Other app";
  return src.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Paginate the orders window and aggregate. `includeCustomer` pulls the
 * protected customer field (needed for returning-customer rate); when the app
 * lacks protected-customer-data access, that field is dropped. Throws on a hard
 * API error so the caller can retry without the customer field. */
async function aggregateOrders(
  shopDomain: string,
  token: string,
  priorSince: string,
  currentSinceMs: number,
  includeCustomer: boolean,
  /** Start of the PRIOR comparison period. Orders older than this are kept for
   * basket analysis but counted in neither KPI bucket: the fetch window is much
   * wider than the comparison window, and lumping six months into "previous"
   * would make every delta nonsense. */
  priorStartMs: number,
) {
  const current = emptyPeriod();
  const previous = emptyPeriod();
  const channels = new Map<string, { revenue: number; orders: number }>();
  let currency: string | null = null;
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

  const customerField = includeCustomer ? "customer { numberOfOrders }" : "";
  // sourceName is a code, and for orders placed through an app it is that app's
  // numeric id: the report was printing "3890849" as if it were a sales channel.
  // The app's own name is the readable version. Dropped and retried without it
  // if the field is ever refused, since a channel label is not worth losing the
  // whole orders pass over.
  let includeApp = true;
  // Per-order records for the basket work, collected in the same pass as the
  // KPI buckets: one Shopify page-through, not two. Line items and discounts
  // both come under read_orders, which every connection already grants, so none
  // of this needs a new scope.
  const orders: BasketOrder[] = [];

  while (pages < ORDERS_MAX_PAGES) {
    const res = await shopifyGraphql(
      shopDomain,
      token,
      `query Orders($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            createdAt
            sourceName
            ${includeApp ? "app { name }" : ""}
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount } }
            lineItems(first: 25) {
              nodes {
                quantity
                title
                originalTotalSet { shopMoney { amount } }
                variant { price }
                product { handle featuredImage { url } }
              }
            }
            ${customerField}
          }
        }
      }`,
      { first: ORDERS_PAGE_SIZE, after: cursor, query: `created_at:>='${priorSince}'` },
    );
    if (!res.ok) {
      const message = res.body?.errors?.[0]?.message ?? `Orders query failed (${res.status})`;
      if (includeApp && /app/i.test(message)) {
        includeApp = false;
        continue;
      }
      throw Object.assign(new Error(message), { code: mapShopifyErrorCode(res.status) });
    }
    const conn = res.body?.data?.orders;
    const nodes: any[] = conn?.nodes ?? [];
    for (const node of nodes) {
      const money = node?.currentTotalPriceSet?.shopMoney;
      const amount = Number.parseFloat(money?.amount ?? "0");
      const rev = Number.isFinite(amount) ? amount : 0;
      if (!currency && money?.currencyCode) currency = money.currencyCode;
      const createdMs = new Date(node?.createdAt ?? 0).getTime();
      const isCurrent = createdMs >= currentSinceMs;
      // Older than the prior period: basket data only, no KPI bucket.
      const bucket = isCurrent ? current : (createdMs >= priorStartMs ? previous : null);
      if (bucket) {
        bucket.order_count += 1;
        bucket.gross_revenue += rev;
        if (includeCustomer) {
          const lifetimeOrders = Number.parseInt(String(node?.customer?.numberOfOrders ?? "0"), 10);
          if (Number.isFinite(lifetimeOrders) && lifetimeOrders > 1) bucket.returning_orders += 1;
        }
      }
      if (isCurrent) {
        const channel = channelLabel(node?.sourceName, node?.app?.name);
        const c = channels.get(channel) ?? { revenue: 0, orders: 0 };
        c.revenue += rev;
        c.orders += 1;
        channels.set(channel, c);
      }
      const liNodes: any[] = node?.lineItems?.nodes ?? [];
      const discount = Number.parseFloat(node?.totalDiscountsSet?.shopMoney?.amount ?? "0");
      orders.push({
        created_ms: new Date(node?.createdAt ?? 0).getTime(),
        revenue: rev,
        discount: Number.isFinite(discount) ? discount : 0,
        units: liNodes.reduce((s, li) => s + (Number(li?.quantity) || 0), 0),
        items: liNodes.map((li) => ({
          title: String(li?.title ?? "").trim(),
          revenue: Number.parseFloat(li?.originalTotalSet?.shopMoney?.amount ?? "0") || 0,
          units: Number(li?.quantity) || 0,
          // Handle, image and unit price so the report can show a real product
          // card that links to the live storefront page, instead of a title in a
          // list. Read off the line item rather than a separate products fetch:
          // these are exactly the products that sell.
          handle: String(li?.product?.handle ?? "").trim() || null,
          image: String(li?.product?.featuredImage?.url ?? "").trim() || null,
          unit_price: Number.parseFloat(li?.variant?.price ?? "0") || null,
        })).filter((i) => i.title),
      });
    }
    pages += 1;
    if (conn?.pageInfo?.hasNextPage && conn?.pageInfo?.endCursor) {
      cursor = conn.pageInfo.endCursor;
      if (pages >= ORDERS_MAX_PAGES) truncated = true;
    } else {
      break;
    }
  }

  return { current, previous, channels, currency, truncated, orders };
}

type BasketOrder = {
  created_ms: number;
  revenue: number;
  discount: number;
  units: number;
  items: Array<{
    title: string;
    revenue: number;
    units: number;
    handle: string | null;
    image: string | null;
    unit_price: number | null;
  }>;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return round2(sorted[idx]);
}

/** Everything the AOV, margin and catalog plays are built from.
 *
 * Deliberately facts only, no advice: the analysis step turns these into plays.
 * Each number carries the window and the order count behind it so a play can say
 * "over 180 days" and a reader can judge the weight of it. */
function analyzeBaskets(
  all: BasketOrder[],
  nowMs: number,
  /** Why a short window might be short, so the report never blames the wrong
   * thing. "truncated" means WE stopped fetching at the page cap; "hasAllOrders"
   * is whether the app actually holds read_all_orders. */
  cause: { truncated: boolean; hasAllOrders: boolean | null },
) {
  const inWindow = (days: number) => all.filter((o) => o.created_ms >= nowMs - days * DAY_MS);
  // Narrowest window with enough orders to mean something; the widest if none.
  let days = BASKET_WINDOWS[BASKET_WINDOWS.length - 1];
  for (const d of BASKET_WINDOWS) {
    if (inWindow(d).length >= BASKET_MIN_ORDERS) { days = d; break; }
  }
  const orders = inWindow(days);
  const n = orders.length;
  if (n === 0) {
    return { window_days: days, orders_analyzed: 0, confident: false };
  }

  // NEVER claim a window wider than the data. Shopify returns only the last 60
  // days of orders unless the app holds read_all_orders, so asking for 180 days
  // can quietly return 60 and the section would print "over 180 days" about two
  // months of data. Report the span actually covered, and flag when the history
  // was cut short so the audit can say what to switch on.
  const oldestMs = Math.min(...orders.map((o) => o.created_ms));
  const spanDays = Math.max(1, Math.ceil((nowMs - oldestMs) / DAY_MS));
  const effectiveDays = Math.min(days, spanDays);
  const shortWindow = days - spanDays > 2;
  // A busy store hits our own 2000-order cap long before Shopify's history cap:
  // Pipeliners came back with 2000 orders spanning 7 days and the report told
  // them to switch on a scope they already had. Only blame the scope when the
  // fetch was NOT capped and the scope is genuinely absent. With no scope
  // reading available, fall back to the old guess rather than asserting either.
  const ordersTruncated = shortWindow && cause.truncated;
  const historyLimited = shortWindow && !cause.truncated
    && (cause.hasAllOrders === null ? true : !cause.hasAllOrders);

  const withItems = orders.filter((o) => o.items.length > 0);
  const singleLine = withItems.filter((o) => o.items.length === 1).length;
  const unitsTotal = orders.reduce((s, o) => s + o.units, 0);

  // What actually gets bought together. Unordered pairs, counted per order, so
  // buying two of the same thing is not a "pair".
  const pairCounts = new Map<string, { a: string; b: string; orders: number; revenue: number }>();
  for (const o of withItems) {
    const titles = [...new Set(o.items.map((i) => i.title))].sort();
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        const key = titles[i] + " || " + titles[j];
        const cur = pairCounts.get(key) ?? { a: titles[i], b: titles[j], orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += o.revenue;
        pairCounts.set(key, cur);
      }
    }
  }
  const pairs = [...pairCounts.values()]
    .filter((p) => p.orders >= MIN_PAIR_ORDERS)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5)
    .map((p) => ({ products: [p.a, p.b], orders: p.orders, revenue: round2(p.revenue) }));

  // Revenue concentration, from line items rather than a sample of orders. Each
  // product carries its handle, image and price so the report can render it as a
  // real card linking to the live product page.
  const byProduct = new Map<string, {
    revenue: number; units: number; orders: number;
    handle: string | null; image: string | null; unit_price: number | null;
  }>();
  for (const o of withItems) {
    for (const i of o.items) {
      const cur = byProduct.get(i.title) ??
        { revenue: 0, units: 0, orders: 0, handle: null, image: null, unit_price: null };
      cur.revenue += i.revenue;
      cur.units += i.units;
      cur.orders += 1;
      cur.handle = cur.handle ?? i.handle;
      cur.image = cur.image ?? i.image;
      cur.unit_price = cur.unit_price ?? i.unit_price;
      byProduct.set(i.title, cur);
    }
  }
  const ranked = [...byProduct.entries()]
    .map(([title, v]) => ({
      title,
      revenue: round2(v.revenue),
      units: v.units,
      orders: v.orders,
      handle: v.handle,
      image: v.image,
      unit_price: v.unit_price,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const totalItemRevenue = ranked.reduce((s, p) => s + p.revenue, 0);
  const topShare = (k: number) =>
    totalItemRevenue > 0 ? round2((ranked.slice(0, k).reduce((s, p) => s + p.revenue, 0) / totalItemRevenue) * 100) : 0;

  const discounted = orders.filter((o) => o.discount > 0);
  const discountDepth = discounted.length > 0
    ? round2((discounted.reduce((s, o) => s + o.discount / Math.max(o.revenue + o.discount, 0.01), 0) / discounted.length) * 100)
    : 0;

  const values = orders.map((o) => o.revenue).sort((a, b) => a - b);

  return {
    window_days: effectiveDays,
    orders_analyzed: n,
    confident: n >= BASKET_MIN_ORDERS,
    // True when Shopify's 60-day order history cap (no read_all_orders scope)
    // stopped us reaching further back than the analysis wanted.
    order_history_limited: historyLimited,
    // True when the window is short because the store is busy enough to fill
    // our page cap, which is a fact about volume, not a missing permission.
    orders_truncated: ordersTruncated,
    units_per_order: round2(unitsTotal / n),
    single_item_order_share: withItems.length > 0 ? round2((singleLine / withItems.length) * 100) : null,
    multi_item_order_share: withItems.length > 0 ? round2(((withItems.length - singleLine) / withItems.length) * 100) : null,
    frequent_pairs: pairs,
    distinct_products_sold: ranked.length,
    top_product_revenue_share: topShare(1),
    top3_product_revenue_share: topShare(3),
    // Ranked by REVENUE, which is why the key is no longer called
    // ...by_units: it was, the cards showed only units, and a product with 3
    // units at $200 sat above one with 5 units at $15, which reads as a broken
    // sort. Both figures travel with each product so the card can show the
    // revenue it is ranked on. Old key kept for the snapshots already stored.
    top_products: ranked.slice(0, 6),
    top_products_by_units: ranked.slice(0, 6),
    discounted_order_share: round2((discounted.length / n) * 100),
    avg_discount_depth_pct: discountDepth,
    order_value_percentiles: { p25: percentile(values, 25), p50: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90) },
  };
}

async function fetchOrdersRollup(
  shopDomain: string,
  token: string,
  storeUrlBase: string | null,
  /** From the Stage 0 scope probe. null when the probe could not answer. */
  hasAllOrders: boolean | null,
) {
  const nowMs = Date.now();
  const currentSince = new Date(nowMs - PERIOD_DAYS * DAY_MS).toISOString();
  const currentSinceMs = nowMs - PERIOD_DAYS * DAY_MS;
  // Fetch far enough back for the widest basket window. The KPI buckets still
  // only count the last 60 days (anything older simply falls in neither), so
  // widening the fetch changes no headline number; it only gives the basket
  // analysis enough orders to say something true on a low-volume store. The page
  // cap still bounds the work for a busy one.
  const priorSince = new Date(nowMs - BASKET_WINDOWS[BASKET_WINDOWS.length - 1] * DAY_MS).toISOString();
  const priorStartMs = nowMs - 2 * PERIOD_DAYS * DAY_MS;

  // The customer field needs protected-customer-data access. If the app doesn't
  // have it, the whole query 4xxs — so retry once without it (revenue/AOV/orders
  // still work; only returning-customer rate is unavailable).
  let customerDataUnavailable = false;
  // WHY it failed, kept rather than swallowed. This silently nulled the
  // returning-customer rate on every audit and the reason was unknowable from
  // the data, which cost an argument about whether Shopify approval was needed
  // (it is not: custom apps always have protected customer data, levels 1 and 2,
  // per shopify.dev/docs/apps/launch/protected-customer-data). Almost always the
  // real cause is the custom app missing the read_customers access scope, which
  // the merchant can add in one click, so the message has to reach us.
  let customerDataError: string | null = null;
  let agg;
  try {
    agg = await aggregateOrders(shopDomain, token, priorSince, currentSinceMs, true, priorStartMs);
  } catch (e) {
    customerDataUnavailable = true;
    customerDataError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    agg = await aggregateOrders(shopDomain, token, priorSince, currentSinceMs, false, priorStartMs);
  }
  const { current, previous, channels, currency, truncated, orders } = agg;
  const basket = analyzeBaskets(orders, nowMs, { truncated, hasAllOrders });

  // The fetch stops at ORDERS_MAX_PAGES. A store doing more than that inside the
  // comparison window therefore returns only its most recent slice, and the
  // prior period is never reached at all. Publishing that as "last 30 days"
  // understated Pipeliner's Cloud by roughly 4x in a client-facing report, with
  // an empty baseline beside it. So say what was actually covered, and drop a
  // comparison we cannot make rather than showing zeroes as if they were real.
  const currentSpanDays = truncated && orders.length > 0
    ? Math.max(1, Math.ceil((nowMs - Math.min(...orders.map((o) => o.created_ms))) / DAY_MS))
    : PERIOD_DAYS;
  const comparisonUsable = !truncated && previous.order_count > 0;

  const cur = summarizePeriod(current);
  const prev = summarizePeriod(previous);
  // Without customer data we can't compute the returning-customer rate; null it
  // out (rather than reporting a misleading 0%).
  const curReturning = customerDataUnavailable ? null : cur.returning_customer_rate;
  const prevReturning = customerDataUnavailable ? null : prev.returning_customer_rate;
  const topProducts = await fetchTopProducts(shopDomain, token, currentSince);

  return {
    // Two-period comparison for the Data & Analytics section.
    timeframe_key: "30d_vs_prior_30d",
    period_days: currentSpanDays,
    /** True when period_days is the span we could reach, not the 30 asked for. */
    period_truncated: truncated,
    current: { ...cur, returning_customer_rate: curReturning },
    previous: comparisonUsable ? { ...prev, returning_customer_rate: prevReturning } : null,
    deltas: !comparisonUsable ? {
      gross_revenue: null,
      order_count: null,
      aov: null,
      returning_customer_rate: null,
    } : {
      gross_revenue: pctDelta(cur.gross_revenue, prev.gross_revenue),
      order_count: pctDelta(cur.order_count, prev.order_count),
      aov: pctDelta(cur.aov, prev.aov),
      returning_customer_rate: customerDataUnavailable ? null : pctDelta(cur.returning_customer_rate, prev.returning_customer_rate),
    },
    returning_customer_rate_available: !customerDataUnavailable,
    returning_customer_rate_error: customerDataError,
    basket,
    top_products: topProducts.items,
    top_products_note: topProducts.note,
    channels: [...channels.entries()]
      .map(([name, v]) => ({ name, revenue: round2(v.revenue), orders: v.orders }))
      .sort((a, b) => b.revenue - a.revenue),
    currency,
    truncated,
    // The customer-facing domain, so the report can link a product card straight
    // to its live page. Prefer the storefront domain the shopper sees over the
    // myshopify one, which redirects and looks wrong in a client report.
    store_url_base: storeUrlBase,
    // Legacy fields (combined 60-day window) so the existing Store Metrics card keeps working.
    timeframe_days: 2 * PERIOD_DAYS,
    order_count: current.order_count + previous.order_count,
    gross_revenue: round2(current.gross_revenue + previous.gross_revenue),
    aov: cur.aov,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await authorize(req);

    const input = (await req.json()) as { audit_id?: string; client_id?: string };
    const auditId = (input.audit_id ?? "").trim();
    const clientId = (input.client_id ?? "").trim();
    if (!auditId || !clientId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or client_id" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceClient();

    const { data: conn, error: connErr } = await sb
      .from("shopify_connections")
      .select("shop_domain, api_version, auth_method, app_client_id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (connErr) throw connErr;

    const { data: sec, error: secErr } = await sb
      .from("client_secrets")
      .select("shopify_admin_token_ciphertext, shopify_admin_token_iv")
      .eq("client_id", clientId)
      .maybeSingle();
    if (secErr) throw secErr;

    const shopDomain = normalizeShopDomain(conn?.shop_domain ?? "");
    if (!shopDomain || !sec?.shopify_admin_token_ciphertext || !sec?.shopify_admin_token_iv) {
      return json({ ok: true, skipped: "no_connection", correlationId }, { status: 200 });
    }
    const storedSecret = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);
    // For client_credentials connections the stored secret is the app client
    // secret; exchange it for a fresh short-lived token. Legacy connections
    // stored the admin token directly.
    let token = storedSecret;
    if (conn?.auth_method === "client_credentials") {
      const grant = await exchangeClientCredentials(shopDomain, conn.app_client_id ?? "", storedSecret);
      if (!grant.ok) {
        return json({ ok: false, error: { code: "token_exchange_failed", message: `Shopify token exchange failed (${grant.status}): ${grant.error}`, status: grant.status }, correlationId }, { status: 200 });
      }
      token = grant.token;
    }

    const now = new Date().toISOString();
    const results: Record<string, unknown> = {};
    // null until the probe answers: "unknown" must stay distinguishable from
    // "checked and absent", or a failed probe silently becomes an accusation.
    let hasAllOrders: boolean | null = null;

    // Stage 0: which scopes the client's custom app actually granted us. Without
    // this, a missing scope shows up only as a mysteriously absent metric, and
    // the fix ("tick read_customers in your app's config") is one click for the
    // merchant once somebody knows to ask. Recorded on the connection so any
    // audit can explain what it could not see and why. Best effort.
    try {
      // Not under /admin/api/{version}: access_scopes lives at /admin/oauth/,
      // unversioned, so shopifyRest's versioned prefix 404s here.
      const scopeRes = await fetch(`https://${shopDomain}/admin/oauth/access_scopes.json`, {
        headers: { "X-Shopify-Access-Token": token, "Accept": "application/json" },
      });
      if (scopeRes.ok) {
        const body = await scopeRes.json().catch(() => ({}));
        const granted = ((body?.access_scopes ?? []) as Array<{ handle?: string }>)
          .map((s) => String(s.handle ?? "")).filter(Boolean).sort();
        await sb.from("shopify_connections").update({
          scopes: { granted, checked_at: now },
          updated_at: now,
        }).eq("client_id", clientId);
        results.scopes = granted.length;
        hasAllOrders = granted.includes("read_all_orders");
      }
    } catch { /* non-fatal */ }

    // Stage 1: shop info
    let storeUrlBase: string | null = null;
    const shopRes = await shopifyRest(shopDomain, token, "/shop.json");
    if (shopRes.ok) {
      const shop = shopRes.body?.shop ?? {};
      const publicDomain = String(shop.domain ?? "").trim();
      if (publicDomain) storeUrlBase = `https://${publicDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
      await sb.from("shopify_data_snapshots").insert({
        audit_id: auditId,
        client_id: clientId,
        snapshot_kind: "shop",
        computed: {
          name: shop.name ?? null,
          currency: shop.currency ?? null,
          timezone: shop.iana_timezone ?? null,
          plan: shop.plan_display_name ?? null,
          domain: shop.domain ?? null,
        },
        raw: shop,
        fetched_at: now,
      });
      results.shop = "ok";
    } else {
      results.shop = `error_${shopRes.status}`;
    }

    // Stage 2: orders rollup (protected data — may fail on scope)
    try {
      const rollup = await fetchOrdersRollup(shopDomain, token, storeUrlBase, hasAllOrders);
      await sb.from("shopify_data_snapshots").insert({
        audit_id: auditId,
        client_id: clientId,
        snapshot_kind: "orders_rollup",
        timeframe_key: rollup.timeframe_key,
        computed: rollup,
        raw: {},
        fetched_at: now,
      });
      if (rollup.aov > 0) {
        await sb.from("audits").update({ aov: rollup.aov }).eq("id", auditId);
      }
      results.orders = "ok";
    } catch (e) {
      results.orders = e instanceof Error ? e.message : "error";
    }

    // Stage 3: products summary
    const productsRes = await shopifyRest(shopDomain, token, "/products.json?limit=50&fields=id,title,handle,status,product_type,vendor,created_at");
    if (productsRes.ok) {
      const products: any[] = productsRes.body?.products ?? [];
      await sb.from("shopify_data_snapshots").insert({
        audit_id: auditId,
        client_id: clientId,
        snapshot_kind: "products",
        computed: {
          sample_count: products.length,
          product_types: [...new Set(products.map((p) => p.product_type).filter(Boolean))].slice(0, 20),
        },
        raw: { products },
        fetched_at: now,
      });
      results.products = "ok";
    } else {
      results.products = `error_${productsRes.status}`;
    }

    await sb.from("shopify_connections").update({ last_verified_at: now, updated_at: now }).eq("client_id", clientId);

    return json({ ok: true, correlationId, results }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
