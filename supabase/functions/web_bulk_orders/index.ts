// Reads a full window of orders for stores that fill the paginated fetch long
// before the window ends.
//
// Split into steps because none of it fits one invocation: `start` submits the
// query, `poll` reports progress, `ingest` streams the finished JSONL and writes
// the rollup. The orchestrator calls poll repeatedly, exactly as it already
// requeues pending screenshot rows.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, exchangeClientCredentials } from "../_shared/shopify-api.ts";
import {
  BULK_WINDOW_DAYS,
  cancelBulk,
  currentBulk,
  ingestBulkOrders,
  pollBulk,
  startBulkOrders,
  type BulkOrderRow,
} from "../_shared/shopify-bulk.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, accept",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...corsHeaders, ...(init?.headers ?? {}) },
  });

const DAY_MS = 86_400_000;

function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Service role not configured");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The store credentials, resolved the same way the snapshot fetcher does. */
async function resolveShop(sb: ReturnType<typeof serviceClient>, clientId: string) {
  const { data: conn } = await sb
    .from("shopify_connections")
    .select("shop_domain, auth_method, app_client_id, scopes")
    .eq("client_id", clientId)
    .maybeSingle();
  const { data: sec } = await sb
    .from("client_secrets")
    .select("shopify_admin_token_ciphertext, shopify_admin_token_iv")
    .eq("client_id", clientId)
    .maybeSingle();

  const shopDomain = normalizeShopDomain(conn?.shop_domain ?? "");
  if (!shopDomain || !sec?.shopify_admin_token_ciphertext || !sec?.shopify_admin_token_iv) return null;

  const stored = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);
  let token = stored;
  if (conn?.auth_method === "client_credentials" && conn.app_client_id) {
    const grant = await exchangeClientCredentials(shopDomain, String(conn.app_client_id), stored);
    if (!grant.ok) return null;
    token = grant.token;
  }
  const granted = ((conn?.scopes as { granted?: unknown } | null)?.granted ?? []) as string[];
  return { shopDomain, token, granted: Array.isArray(granted) ? granted : [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();

  try {
    const input = (await req.json()) as { client_id?: string; mode?: string; operation_id?: string };
    const clientId = (input.client_id ?? "").trim();
    const mode = (input.mode ?? "start").trim();
    if (!clientId) return json({ ok: false, error: "Missing client_id", correlationId }, { status: 400 });

    const sb = serviceClient();
    const shop = await resolveShop(sb, clientId);
    if (!shop) return json({ ok: true, skipped: "no_connection", correlationId });

    const { shopDomain, token, granted } = shop;

    if (mode === "start") {
      // read_all_orders is what makes a 90-day read possible at all; without it
      // Shopify serves 60 days whatever we ask for, and bulk cannot change that.
      const hasAllOrders = granted.includes("read_all_orders");
      const windowDays = hasAllOrders ? BULK_WINDOW_DAYS : 60;
      const sinceIso = new Date(Date.now() - windowDays * DAY_MS).toISOString();

      // Adopt an operation already in flight rather than colliding with it.
      const running = await currentBulk(shopDomain, token);
      if (running && (running.status === "CREATED" || running.status === "RUNNING")) {
        return json({ ok: true, adopted: true, operation_id: running.id, window_days: windowDays, correlationId });
      }

      const started = await startBulkOrders(shopDomain, token, sinceIso, granted.includes("read_customers"));
      if (!started.ok) {
        return json({ ok: false, error: started.error, already_running: started.alreadyRunning ?? false, correlationId });
      }
      return json({ ok: true, operation_id: started.id, window_days: windowDays, correlationId });
    }

    const operationId = (input.operation_id ?? "").trim();
    if (!operationId) return json({ ok: false, error: "Missing operation_id", correlationId }, { status: 400 });

    if (mode === "poll") {
      const status = await pollBulk(shopDomain, token, operationId);
      return json({ ok: true, status, correlationId });
    }

    if (mode === "cancel") {
      await cancelBulk(shopDomain, token, operationId);
      return json({ ok: true, cancelled: true, correlationId });
    }

    if (mode === "ingest") {
      const status = await pollBulk(shopDomain, token, operationId);
      if (status.state !== "complete") {
        return json({ ok: false, error: `not_complete: ${status.state}`, status, correlationId });
      }
      if (!status.url) {
        // Completed with no URL means the query matched nothing.
        return json({ ok: true, orders: 0, lines: 0, empty: true, correlationId });
      }
      const started = Date.now();
      const ingested = await ingestBulkOrders(status.url);
      if (!ingested.ok) return json({ ok: false, error: ingested.error, correlationId });

      const orders: BulkOrderRow[] = ingested.orders;
      const oldest = orders.length ? Math.min(...orders.map((o) => o.created_ms)) : 0;
      return json({
        ok: true,
        orders: orders.length,
        lines: ingested.lines,
        object_count: status.objectCount,
        file_size: status.fileSize,
        span_days: oldest ? Math.ceil((Date.now() - oldest) / DAY_MS) : 0,
        revenue: Math.round(orders.reduce((s, o) => s + o.revenue, 0)),
        units: orders.reduce((s, o) => s + o.units, 0),
        ingest_ms: Date.now() - started,
        correlationId,
      });
    }

    return json({ ok: false, error: `Unknown mode: ${mode}`, correlationId }, { status: 400 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e), correlationId }, { status: 500 });
  }
});
