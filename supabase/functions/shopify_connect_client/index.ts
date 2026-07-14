import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization } from "../_shared/auth.ts";
import { encryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, mapShopifyErrorCode, SHOPIFY_API_VERSION } from "../_shared/shopify-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: { code: "config_missing", message: "Supabase env missing" }, correlationId }, { status: 500 });
    }
    await getUserIdFromAuthorization(req);

    const input = (await req.json()) as { client_id?: string; shop_domain?: string; access_token?: string };
    const clientId = (input.client_id ?? "").trim();
    const accessToken = (input.access_token ?? "").trim();
    const shopDomain = normalizeShopDomain(input.shop_domain ?? "");
    if (!clientId || !accessToken) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing client_id or access_token" }, correlationId }, { status: 400 });
    }
    if (!shopDomain) {
      return json({ ok: false, error: { code: "bad_request", message: "Enter a valid *.myshopify.com store domain" }, correlationId }, { status: 400 });
    }

    // Verify against Shopify
    const shopRes = await shopifyRest(shopDomain, accessToken, "/shop.json");
    if (!shopRes.ok) {
      return json(
        { ok: false, error: { code: mapShopifyErrorCode(shopRes.status), message: "Shop lookup failed", status: shopRes.status }, correlationId },
        { status: 200 },
      );
    }

    const shop = shopRes.body?.shop ?? null;
    const shopId = shop?.id != null ? String(shop.id) : null;
    const shopName = shop?.name ?? null;
    const currency = shop?.currency ?? null;
    const timezone = shop?.iana_timezone ?? shop?.timezone ?? null;
    const planName = shop?.plan_display_name ?? shop?.plan_name ?? null;
    const primaryDomain = shop?.domain ? `https://${shop.domain}` : null;

    const sb = assertServiceClient();

    // Enforce 1 shop = 1 client.
    const { data: existingConn, error: existingConnErr } = await sb
      .from("shopify_connections")
      .select("client_id")
      .eq("shop_domain", shopDomain)
      .neq("client_id", clientId)
      .maybeSingle();
    if (existingConnErr) throw existingConnErr;
    if (existingConn?.client_id) {
      return json(
        { ok: false, correlationId, error: { code: "client_exists", message: "A client with this Shopify store already exists." } },
        { status: 200 },
      );
    }

    // Store encrypted token
    const enc = await encryptString(accessToken);
    await sb.from("client_secrets").upsert(
      {
        client_id: clientId,
        shopify_admin_token_ciphertext: enc.ciphertext,
        shopify_admin_token_iv: enc.iv,
        shopify_admin_token_alg: enc.alg,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );

    await sb.from("clients").update({ shopify_connected: true }).eq("id", clientId);
    if (primaryDomain) {
      const { data: existingClient } = await sb.from("clients").select("website_url").eq("id", clientId).maybeSingle();
      if (!(existingClient?.website_url ?? "").trim()) {
        await sb.from("clients").update({ website_url: primaryDomain }).eq("id", clientId);
      }
    }

    await sb.from("shopify_connections").upsert(
      {
        client_id: clientId,
        shop_domain: shopDomain,
        shop_id: shopId,
        shop_name: shopName,
        currency,
        timezone,
        plan_name: planName,
        auth_method: "admin_token",
        api_version: SHOPIFY_API_VERSION,
        scopes: { shop: true },
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );

    return json(
      {
        ok: true,
        correlationId,
        shop: { id: shopId, name: shopName, domain: shopDomain, primaryDomain, currency, timezone, planName },
      },
      { status: 200 },
    );
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
