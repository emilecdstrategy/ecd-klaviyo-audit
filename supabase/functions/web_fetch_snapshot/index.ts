import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, shopifyGraphql, mapShopifyErrorCode, exchangeClientCredentials } from "../_shared/shopify-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PERIOD_DAYS = 30;
const ORDERS_PAGE_SIZE = 250;
const ORDERS_MAX_PAGES = 8; // cap at 2000 orders across the 60-day window
const TOP_PRODUCTS_SAMPLE = 100; // recent current-period orders sampled for top-products ranking
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function fetchOrdersRollup(shopDomain: string, token: string) {
  const nowMs = Date.now();
  const currentSince = new Date(nowMs - PERIOD_DAYS * DAY_MS).toISOString();
  const priorSince = new Date(nowMs - 2 * PERIOD_DAYS * DAY_MS).toISOString();
  const currentSinceMs = nowMs - PERIOD_DAYS * DAY_MS;

  const current = emptyPeriod();
  const previous = emptyPeriod();
  const channels = new Map<string, { revenue: number; orders: number }>();
  let currency: string | null = null;
  let cursor: string | null = null;
  let pages = 0;
  let truncated = false;

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
            customer { numberOfOrders }
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
      const isCurrent = new Date(node?.createdAt ?? 0).getTime() >= currentSinceMs;
      const bucket = isCurrent ? current : previous;
      bucket.order_count += 1;
      bucket.gross_revenue += rev;
      const lifetimeOrders = Number.parseInt(String(node?.customer?.numberOfOrders ?? "0"), 10);
      if (Number.isFinite(lifetimeOrders) && lifetimeOrders > 1) bucket.returning_orders += 1;
      if (isCurrent) {
        const channel = String(node?.sourceName ?? "").trim() || "unknown";
        const c = channels.get(channel) ?? { revenue: 0, orders: 0 };
        c.revenue += rev;
        c.orders += 1;
        channels.set(channel, c);
      }
    }
    pages += 1;
    if (conn?.pageInfo?.hasNextPage && conn?.pageInfo?.endCursor) {
      cursor = conn.pageInfo.endCursor;
      if (pages >= ORDERS_MAX_PAGES) truncated = true;
    } else {
      break;
    }
  }

  const cur = summarizePeriod(current);
  const prev = summarizePeriod(previous);
  const topProducts = await fetchTopProducts(shopDomain, token, currentSince);

  return {
    // Two-period comparison for the Data & Analytics section.
    timeframe_key: "30d_vs_prior_30d",
    period_days: PERIOD_DAYS,
    current: cur,
    previous: prev,
    deltas: {
      gross_revenue: pctDelta(cur.gross_revenue, prev.gross_revenue),
      order_count: pctDelta(cur.order_count, prev.order_count),
      aov: pctDelta(cur.aov, prev.aov),
      returning_customer_rate: pctDelta(cur.returning_customer_rate, prev.returning_customer_rate),
    },
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
