import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getScreenshotProvider } from "../_shared/screenshot-provider.ts";
import { browserlessEnabled, captureWithBrowserless, type CapturedElement } from "../_shared/browserless.ts";
import { decryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, exchangeClientCredentials } from "../_shared/shopify-api.ts";

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
    sb.from("shopify_connections").select("shop_domain, auth_method, app_client_id").eq("client_id", clientId).maybeSingle(),
    sb.from("client_secrets").select("shopify_admin_token_ciphertext, shopify_admin_token_iv").eq("client_id", clientId).maybeSingle(),
  ]);
  const shopDomain = normalizeShopDomain(conn?.shop_domain ?? "");
  if (!shopDomain || !sec?.shopify_admin_token_ciphertext || !sec?.shopify_admin_token_iv) return null;
  try {
    const storedSecret = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);
    if (conn?.auth_method === "client_credentials") {
      const grant = await exchangeClientCredentials(shopDomain, conn.app_client_id ?? "", storedSecret);
      if (!grant.ok) return null;
      return { shopDomain, token: grant.token };
    }
    return { shopDomain, token: storedSecret };
  } catch {
    return null;
  }
}

async function detectFromShopify(
  sb: ReturnType<typeof assertServiceClient>,
  clientId: string,
  origin: string,
): Promise<{ product?: string; collection?: string; variantId?: string }> {
  const creds = await decryptShopifyToken(sb, clientId);
  if (!creds) return {};
  const out: { product?: string; collection?: string; variantId?: string } = {};
  try {
    // Full product objects (not just handle) so we can also grab a variant id
    // for the add-to-cart permalink used by the cart capture.
    const res = await shopifyRest(creds.shopDomain, creds.token, "/products.json?limit=5&status=active");
    const prod = res.ok ? res.body?.products?.find((p: { handle?: string }) => p?.handle) : null;
    if (prod?.handle) out.product = `${origin}/products/${prod.handle}`;
    const variantId = prod?.variants?.find((v: { id?: number | string }) => v?.id)?.id;
    if (variantId) out.variantId = String(variantId);
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

// Public storefront JSON, available on virtually every Shopify store without an
// Admin connection. This is what unlocks a real product + a variant id (for the
// populated-cart permalink) and a real collection for un-connected clients.
async function detectFromStorefront(
  origin: string,
): Promise<{ product?: string; collection?: string; variantId?: string }> {
  const out: { product?: string; collection?: string; variantId?: string } = {};
  const headers = { "user-agent": "Mozilla/5.0 (compatible; ECDAuditBot/1.0)", accept: "application/json" };

  try {
    const res = await fetch(`${origin}/products.json?limit=50`, { headers, redirect: "follow" });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        products?: Array<{
          handle?: string;
          images?: Array<unknown>;
          variants?: Array<{ id?: number | string; price?: string; available?: boolean }>;
        }>;
      } | null;
      const products = (body?.products ?? []).filter((p) => p?.handle && (p.variants ?? []).length > 0);
      // Prefer a flagship-looking product: has an image, an available variant, and
      // the highest price (avoids picking a cheap accessory like "adapter-pins").
      const priceOf = (p: { variants?: Array<{ price?: string }> }) =>
        Math.max(0, ...(p.variants ?? []).map((v) => parseFloat(v.price ?? "0") || 0));
      const withImage = products.filter((p) => (p.images ?? []).length > 0);
      const pool = withImage.length ? withImage : products;
      const chosen = pool.slice().sort((a, b) => priceOf(b) - priceOf(a))[0];
      if (chosen?.handle) {
        out.product = `${origin}/products/${chosen.handle}`;
        const variant = (chosen.variants ?? []).find((v) => v?.available !== false && v?.id) ??
          (chosen.variants ?? []).find((v) => v?.id);
        if (variant?.id) out.variantId = String(variant.id);
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(`${origin}/collections.json?limit=50`, { headers, redirect: "follow" });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        collections?: Array<{ handle?: string; products_count?: number }>;
      } | null;
      const cols = (body?.collections ?? []).filter((c) => c?.handle);
      // Skip generic catch-all collections when a more specific one exists.
      const specific = cols.filter((c) => !["frontpage", "all"].includes((c.handle ?? "").toLowerCase()));
      const chosen = (specific.length ? specific : cols)[0];
      if (chosen?.handle) out.collection = `${origin}/collections/${chosen.handle}`;
    }
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
  let variantId: string | undefined;

  // Detection precedence: manual input > Shopify Admin > public storefront JSON >
  // homepage HTML regex. Each source fills whatever the previous left unresolved.
  const viaShopify = await detectFromShopify(sb, clientId, origin);
  if (!product && viaShopify.product) product = normalizeUrl(viaShopify.product);
  if (!collection && viaShopify.collection) collection = normalizeUrl(viaShopify.collection);
  if (viaShopify.variantId) variantId = viaShopify.variantId;

  // Public storefront JSON works without a Shopify connection and, crucially,
  // yields a variant id to populate the cart.
  if (!product || !collection || !variantId) {
    const viaStore = await detectFromStorefront(origin);
    if (!product && viaStore.product) product = normalizeUrl(viaStore.product);
    if (!collection && viaStore.collection) collection = normalizeUrl(viaStore.collection);
    if (!variantId && viaStore.variantId) variantId = viaStore.variantId;
  }

  if (!product || !collection) {
    const viaHtml = await detectFromHtml(homepage, origin);
    product = product ?? (viaHtml.product ? normalizeUrl(viaHtml.product) : null);
    collection = collection ?? (viaHtml.collection ? normalizeUrl(viaHtml.collection) : null);
  }

  // Cart: captured as a POPULATED cart. At capture time we load the homepage, add
  // the flagship variant via Shopify's AJAX cart API, then click the cart trigger
  // (opens the slide drawer on drawer themes, or the /cart page otherwise). This
  // avoids the /cart/{variant}:1 permalink, which redirects to checkout on many
  // themes. The variant id is stashed on the cart rows below.
  const cart = normalizeUrl(input.cart) ?? homepage;

  const targets: Array<{ page_type: string; url: string }> = [{ page_type: "homepage", url: homepage }];
  if (product) targets.push({ page_type: "product", url: product });
  if (collection) targets.push({ page_type: "collection", url: collection });
  targets.push({ page_type: "cart", url: cart });

  // Only the 'viewport' (above-the-fold) shot per page/viewport. It's what the AI
  // vision analyzes AND what the report displays; the old heavy full-page 'full'
  // variant only fed an optional lightbox zoom and roughly doubled the load on
  // the screenshot service (the main cause of local_rate_limited). 8 rows total
  // when all pages resolve.
  const rows = targets.flatMap((t) =>
    VIEWPORTS.flatMap((viewport) => {
      const variants = ["viewport"];
      return variants.map((variant) => ({
        audit_id: auditId,
        client_id: clientId,
        page_type: t.page_type,
        viewport,
        variant,
        url: t.url,
        status: "pending",
        raw: t.page_type === "cart" && variantId ? { variant_id: variantId } : {},
      }));
    }),
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
  // Prefer rows we haven't touched yet (fetched_at null) over ones we requeued
  // after a rate-limit, so a stuck store doesn't block the others.
  const { data: row, error: rowErr } = await sb
    .from("web_page_snapshots")
    .select("id, page_type, viewport, variant, url, raw")
    .eq("audit_id", auditId)
    .eq("status", "pending")
    .order("fetched_at", { ascending: true, nullsFirst: true })
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

  // Only click the slide-drawer when the cart capture targets a non-/cart page
  // (the homepage fallback). A /cart permalink already lands on a populated
  // cart page, so we screenshot it directly.
  let interaction: "cart_drawer" | undefined;
  if (row.page_type === "cart") {
    let path = "";
    try { path = new URL(row.url).pathname; } catch { /* ignore */ }
    if (!/^\/cart(\/|$)/.test(path)) interaction = "cart_drawer";
  }

  const isViewport = (row as { variant?: string }).variant === "viewport";
  let png: Uint8Array | null = null;
  let elements: CapturedElement[] = [];
  let captureError = "";
  let browserlessError = ""; // kept separate so the fallback's error doesn't hide it
  let usedBrowserless = false;

  // When Browserless is configured it handles every capture (full-page and
  // viewport): ad + cookie-banner blocking are built in, the cart drawer is a
  // scripted click, and the viewport shot also returns real element boxes so
  // findings pin an actual element instead of a guessed coordinate. ScreenshotOne
  // remains the fallback below if Browserless is unset or a call fails.
  const isCart = row.page_type === "cart";
  if (browserlessEnabled()) {
    const cartAdd = isCart
      ? { variantId: (row as { raw?: { variant_id?: string } }).raw?.variant_id ?? null }
      : undefined;
    const blInput = {
      url: row.url,
      viewport: row.viewport as "desktop" | "mobile",
      // The cart drawer is a viewport overlay, so never full-page for cart.
      fullPage: !isViewport && !isCart,
      withElements: isViewport,
      cartAdd,
    };
    let bl = await captureWithBrowserless(blInput);
    if (!bl.ok) { await new Promise((r) => setTimeout(r, 4000)); bl = await captureWithBrowserless(blInput); }
    if (bl.ok) {
      png = bl.png;
      elements = bl.elements;
      usedBrowserless = true;
    } else {
      browserlessError = bl.error; // remember it
      captureError = bl.error;
    }
  }

  // Browserless is the reliable primary; ScreenshotOne's plan rate-limits under
  // load. So if Browserless failed, retry IT across a few requeue passes before
  // ever touching ScreenshotOne, most misses are transient and a later pass
  // succeeds on Browserless (no rate-limit, no fallback).
  if (!png && browserlessEnabled()) {
    const rawObj = ((row as { raw?: Record<string, unknown> }).raw ?? {}) as Record<string, unknown>;
    const blAttempts = Number(rawObj.bl_attempts ?? 0);
    if (blAttempts < 3) {
      await sb.from("web_page_snapshots").update({
        raw: { ...rawObj, bl_attempts: blAttempts + 1, capture_note: `browserless_retry_${blAttempts + 1}: ${browserlessError}`.slice(0, 300) },
        error_message: null,
        fetched_at: new Date().toISOString(),
      }).eq("id", row.id);
      return { processed: 0, requeued: true, remaining: await countRemaining() };
    }
  }

  // ScreenshotOne, only after Browserless has been retried and still failed.
  if (!png) {
    const provider = getScreenshotProvider();
    const captureInput = {
      url: row.url,
      viewport: row.viewport as "desktop" | "mobile",
      interaction,
      fullPage: !isViewport,
    };
    let result = await provider.capture(captureInput);
    // Storefronts rate-limit the screenshot service under rapid hits (serving a
    // blank error page). Retry with a growing backoff so the store's rate-limit
    // window has time to reset between attempts.
    for (let attempt = 1; attempt <= 2 && !result.ok; attempt++) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      result = await provider.capture(captureInput);
    }
    if (result.ok) {
      png = result.png;
      elements = [];
    } else {
      captureError = result.error;
    }
  }

  const now = new Date().toISOString();

  if (png) {
    const variantSuffix = isViewport ? "_viewport" : "";
    const path = `${clientId}/${auditId}/web/${row.page_type}_${row.viewport}${variantSuffix}.png`;
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (uploadErr) {
      await sb.from("web_page_snapshots").update({
        status: "error",
        error_message: `upload_failed: ${uploadErr.message}`.slice(0, 500),
        fetched_at: now,
      }).eq("id", row.id);
    } else {
      const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      // If Browserless failed and we recovered via ScreenshotOne, keep a
      // diagnostic note (the capture still succeeded) so we can see which
      // provider handled it and why Browserless fell back.
      const rawObj = ((row as { raw?: Record<string, unknown> }).raw ?? {}) as Record<string, unknown>;
      const raw = usedBrowserless
        ? rawObj
        : { ...rawObj, capture_note: `via_screenshotone${browserlessError ? `; browserless: ${browserlessError}` : ""}`.slice(0, 300) };
      await sb.from("web_page_snapshots").update({
        status: "success",
        screenshot_path: path,
        screenshot_url: pub?.publicUrl ?? null,
        elements,
        error_message: null,
        raw,
        fetched_at: now,
      }).eq("id", row.id);
    }
  } else {
    // A ScreenshotOne "local_rate_limited" (plan concurrency) or store bot-block
    // is transient: requeue the row (keep it pending, deprioritized) so the
    // orchestrator retries it later once the limit clears. Bounded so a
    // genuinely broken page eventually errors out instead of looping forever.
    const rawObj = ((row as { raw?: Record<string, unknown> }).raw ?? {}) as Record<string, unknown>;
    const attempts = Number(rawObj.capture_attempts ?? 0) + 1;
    const rateLimited = /rate_limited|rate.?limit|429|too_many/i.test(captureError);
    const blSuffix = browserlessError ? ` | browserless: ${browserlessError}` : "";
    if (rateLimited && attempts < 5) {
      await sb.from("web_page_snapshots").update({
        raw: { ...rawObj, capture_attempts: attempts },
        error_message: `${captureError} (rate-limited; requeued, attempt ${attempts})${blSuffix}`.slice(0, 500),
        fetched_at: now,
      }).eq("id", row.id);
      return { processed: 0, requeued: true, remaining: await countRemaining() };
    }
    await sb.from("web_page_snapshots").update({
      status: "error",
      error_message: `${captureError || "capture_failed"}${blSuffix}`.slice(0, 500),
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
