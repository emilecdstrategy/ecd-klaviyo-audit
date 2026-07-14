import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, shopifyGraphql, mapShopifyErrorCode } from "../_shared/shopify-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ORDERS_TIMEFRAME_DAYS = 60;
const ORDERS_PAGE_SIZE = 250;
const ORDERS_MAX_PAGES = 8; // cap at 2000 orders for the rollup

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

async function fetchOrdersRollup(shopDomain: string, token: string) {
  const since = new Date(Date.now() - ORDERS_TIMEFRAME_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let cursor: string | null = null;
  let orderCount = 0;
  let grossRevenue = 0;
  let currency: string | null = null;
  let pages = 0;
  let truncated = false;

  while (pages < ORDERS_MAX_PAGES) {
    const res = await shopifyGraphql(
      shopDomain,
      token,
      `query Orders($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            currentTotalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }`,
      { first: ORDERS_PAGE_SIZE, after: cursor, query: `created_at:>='${since}'` },
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
      if (Number.isFinite(amount)) grossRevenue += amount;
      if (!currency && money?.currencyCode) currency = money.currencyCode;
      orderCount += 1;
    }
    pages += 1;
    if (conn?.pageInfo?.hasNextPage && conn?.pageInfo?.endCursor) {
      cursor = conn.pageInfo.endCursor;
      if (pages >= ORDERS_MAX_PAGES) truncated = true;
    } else {
      break;
    }
  }

  const aov = orderCount > 0 ? grossRevenue / orderCount : 0;
  return {
    timeframe_days: ORDERS_TIMEFRAME_DAYS,
    since,
    order_count: orderCount,
    gross_revenue: Math.round(grossRevenue * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    currency,
    truncated,
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
      .select("shop_domain, api_version")
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
    const token = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);

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
        timeframe_key: `last_${ORDERS_TIMEFRAME_DAYS}_days`,
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
