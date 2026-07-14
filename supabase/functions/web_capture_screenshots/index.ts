import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getScreenshotProvider } from "../_shared/screenshot-provider.ts";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest } from "../_shared/shopify-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STORAGE_BUCKET = "audit-assets";
const VIEWPORTS = ["desktop", "mobile"] as const;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
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

function normalizeUrl(raw: unknown): string | null {
  const url = String(raw ?? "").trim();
  if (!url) return null;
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withProto).toString();
  } catch {
    return null;
  }
}

function originOf(url: string): string {
  return new URL(url).origin;
}

// --- Page auto-detection -----------------------------------------------------

async function decryptShopifyToken(sb: ReturnType<typeof assertServiceClient>, clientId: string) {
  const [{ data: conn }, { data: sec }] = await Promise.all([
    sb.from("shopify_connections").select("shop_domain").eq("client_id", clientId).maybeSingle(),
    sb.from("client_secrets").select("shopify_admin_token_ciphertext, shopify_admin_token_iv").eq("client_id", clientId).maybeSingle(),
  ]);
  const shopDomain = normalizeShopDomain(conn?.shop_domain ?? "");
  if (!shopDomain || !sec?.shopify_admin_token_ciphertext || !sec?.shopify_admin_token_iv) return null;
  try {
    const token = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);
    return { shopDomain, token };
  } catch {
    return null;
  }
}

async function detectFromShopify(
  sb: ReturnType<typeof assertServiceClient>,
  clientId: string,
  origin: string,
): Promise<{ product?: string; collection?: string }> {
  const creds = await decryptShopifyToken(sb, clientId);
  if (!creds) return {};
  const out: { product?: string; collection?: string } = {};
  try {
    const res = await shopifyRest(creds.shopDomain, creds.token, "/products.json?limit=5&status=active&fields=handle");
    const handle = res.ok ? res.body?.products?.find((p: { handle?: string }) => p?.handle)?.handle : null;
    if (handle) out.product = `${origin}/products/${handle}`;
  } catch { /* ignore */ }
  try {
    const [custom, smart] = await Promise.all([
      shopifyRest(creds.shopDomain, creds.token, "/custom_collections.json?limit=5&fields=handle"),
      shopifyRest(creds.shopDomain, creds.token, "/smart_collections.json?limit=5&fields=handle"),
    ]);
    const handle = (custom.ok ? custom.body?.custom_collections?.find((c: { handle?: string }) => c?.handle)?.handle : null)
      ?? (smart.ok ? smart.body?.smart_collections?.find((c: { handle?: string }) => c?.handle)?.handle : null);
    if (handle) out.collection = `${origin}/collections/${handle}`;
  } catch { /* ignore */ }
  return out;
}

async function detectFromHtml(homepage: string, origin: string): Promise<{ product?: string; collection?: string }> {
  try {
    const res = await fetch(homepage, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ECDAuditBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return {};
    const html = await res.text();
    const out: { product?: string; collection?: string } = {};
    const product = html.match(/\/products\/[a-z0-9][a-z0-9-]*/i)?.[0];
    const collection = html.match(/\/collections\/[a-z0-9][a-z0-9-]*/i)?.[0];
    // Skip the generic /collections/all when a more specific one might exist further down.
    if (product) out.product = `${origin}${product}`;
    if (collection) out.collection = `${origin}${collection}`;
    return out;
  } catch {
    return {};
  }
}

// --- Handlers ----------------------------------------------------------------

async function seed(
  sb: ReturnType<typeof assertServiceClient>,
  auditId: string,
  clientId: string,
  input: { homepage?: string; product?: string; collection?: string; cart?: string },
) {
  const homepage = normalizeUrl(input.homepage);
  if (!homepage) return { error: "Invalid or missing homepage URL" };
  const origin = originOf(homepage);

  let product = normalizeUrl(input.product);
  let collection = normalizeUrl(input.collection);

  if (!product || !collection) {
    const viaShopify = await detectFromShopify(sb, clientId, origin);
    product = product ?? (viaShopify.product ? normalizeUrl(viaShopify.product) : null);
    collection = collection ?? (viaShopify.collection ? normalizeUrl(viaShopify.collection) : null);
  }
  if (!product || !collection) {
    const viaHtml = await detectFromHtml(homepage, origin);
    product = product ?? (viaHtml.product ? normalizeUrl(viaHtml.product) : null);
    collection = collection ?? (viaHtml.collection ? normalizeUrl(viaHtml.collection) : null);
  }

  // Cart: always attempt the slide-drawer on the homepage (falls back to /cart
  // inside the screenshot function if no drawer trigger is found).
  const cart = normalizeUrl(input.cart) ?? homepage;

  const targets: Array<{ page_type: string; url: string }> = [{ page_type: "homepage", url: homepage }];
  if (product) targets.push({ page_type: "product", url: product });
  if (collection) targets.push({ page_type: "collection", url: collection });
  targets.push({ page_type: "cart", url: cart });

  const rows = targets.flatMap((t) =>
    VIEWPORTS.map((viewport) => ({
      audit_id: auditId,
      client_id: clientId,
      page_type: t.page_type,
      viewport,
      url: t.url,
      status: "pending",
    })),
  );

  await sb.from("web_page_snapshots").delete().eq("audit_id", auditId);
  const { error: insErr } = await sb.from("web_page_snapshots").insert(rows);
  if (insErr) throw insErr;

  return {
    total: rows.length,
    resolved: {
      product: product ?? null,
      collection: collection ?? null,
      detected: { product: Boolean(product), collection: Boolean(collection) },
    },
  };
}

async function captureOne(sb: ReturnType<typeof assertServiceClient>, auditId: string, clientId: string) {
  const { data: row, error: rowErr } = await sb
    .from("web_page_snapshots")
    .select("id, page_type, viewport, url")
    .eq("audit_id", auditId)
    .eq("status", "pending")
    .order("page_type", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (rowErr) throw rowErr;

  const countRemaining = async () => {
    const { count } = await sb
      .from("web_page_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId)
      .eq("status", "pending");
    return count ?? 0;
  };

  if (!row) return { processed: 0, remaining: await countRemaining() };

  const provider = getScreenshotProvider();
  const captureInput = {
    url: row.url,
    viewport: row.viewport as "desktop" | "mobile",
    interaction: (row.page_type === "cart" ? "cart_drawer" : undefined) as "cart_drawer" | undefined,
  };
  let result = await provider.capture(captureInput);
  // A cold Lambda + heavy storefront can miss the timeout on the first shot;
  // the retry runs against a now-warm container and usually succeeds.
  if (!result.ok && result.error === "capture_timeout") {
    result = await provider.capture(captureInput);
  }
  const now = new Date().toISOString();

  if (result.ok) {
    const path = `${clientId}/${auditId}/web/${row.page_type}_${row.viewport}.png`;
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, result.png, { contentType: "image/png", upsert: true });
    if (uploadErr) {
      await sb.from("web_page_snapshots").update({
        status: "error",
        error_message: `upload_failed: ${uploadErr.message}`.slice(0, 500),
        fetched_at: now,
      }).eq("id", row.id);
    } else {
      const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await sb.from("web_page_snapshots").update({
        status: "success",
        screenshot_path: path,
        screenshot_url: pub?.publicUrl ?? null,
        error_message: null,
        fetched_at: now,
      }).eq("id", row.id);
    }
  } else {
    await sb.from("web_page_snapshots").update({
      status: "error",
      error_message: result.error.slice(0, 500),
      fetched_at: now,
    }).eq("id", row.id);
  }

  return { processed: 1, remaining: await countRemaining() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await authorize(req);

    const input = (await req.json()) as {
      action?: "seed" | "capture_one";
      audit_id?: string;
      client_id?: string;
      pages?: { homepage?: string; product?: string; collection?: string; cart?: string };
    };
    const auditId = (input.audit_id ?? "").trim();
    const clientId = (input.client_id ?? "").trim();
    const action = input.action ?? "seed";
    if (!auditId || !clientId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or client_id" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceClient();

    if (action === "seed") {
      const result = await seed(sb, auditId, clientId, input.pages ?? {});
      if ("error" in result) {
        return json({ ok: false, error: { code: "bad_request", message: result.error }, correlationId }, { status: 400 });
      }
      return json({ ok: true, correlationId, ...result }, { status: 200 });
    }

    // capture_one
    const { processed, remaining } = await captureOne(sb, auditId, clientId);
    return json({ ok: true, correlationId, processed, remaining, done: remaining === 0 }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
