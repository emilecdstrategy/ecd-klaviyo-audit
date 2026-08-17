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
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount } }
            lineItems(first: 25) {
              nodes {
                quantity
                title
                originalTotalSet { shopMoney { amount } }
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
        const channel = String(node?.sourceName ?? "").trim() || "unknown";
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
  items: Array<{ title: string; revenue: number }>;
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
function analyzeBaskets(all: BasketOrder[], nowMs: number) {
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
  const historyLimited = days - spanDays > 2;

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

  // Revenue concentration, from line items rather than a sample of orders.
  const byProduct = new Map<string, number>();
  for (const o of withItems) {
    for (const i of o.items) byProduct.set(i.title, (byProduct.get(i.title) ?? 0) + i.revenue);
  }
  const ranked = [...byProduct.entries()].map(([title, revenue]) => ({ title, revenue: round2(revenue) }))
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
    units_per_order: round2(unitsTotal / n),
    single_item_order_share: withItems.length > 0 ? round2((singleLine / withItems.length) * 100) : null,
    multi_item_order_share: withItems.length > 0 ? round2(((withItems.length - singleLine) / withItems.length) * 100) : null,
    frequent_pairs: pairs,
    distinct_products_sold: ranked.length,
    top_product_revenue_share: topShare(1),
    top3_product_revenue_share: topShare(3),
    top_products_by_units: ranked.slice(0, 5),
    discounted_order_share: round2((discounted.length / n) * 100),
    avg_discount_depth_pct: discountDepth,
    order_value_percentiles: { p25: percentile(values, 25), p50: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90) },
  };
}

async function fetchOrdersRollup(shopDomain: string, token: string) {
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
  const basket = analyzeBaskets(orders, nowMs);

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
    period_days: PERIOD_DAYS,
    current: { ...cur, returning_customer_rate: curReturning },
    previous: { ...prev, returning_customer_rate: prevReturning },
    deltas: {
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
      }
    } catch { /* non-fatal */ }

    // Stage 1: shop info
    const shopRes = await shopifyRest(shopDomain, token, "/shop.json");
    if (shopRes.ok) {
      const shop = shopRes.body?.shop ?? {};
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
      const rollup = await fetchOrdersRollup(shopDomain, token);
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
