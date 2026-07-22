import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization } from "../_shared/auth.ts";
import { encryptString } from "../_shared/crypto.ts";
import { normalizeShopDomain, shopifyRest, mapShopifyErrorCode, exchangeClientCredentials, fetchInstalledAppToken, SHOPIFY_API_VERSION } from "../_shared/shopify-api.ts";

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

    const input = (await req.json()) as {
      client_id?: string;
      shop_domain?: string;
      access_token?: string;
      shopify_client_id?: string;
      shopify_client_secret?: string;
      use_installed_app?: boolean;
      website_url?: string;
    };
    const clientId = (input.client_id ?? "").trim();
    const appClientId = (input.shopify_client_id ?? "").trim();
    const appClientSecret = (input.shopify_client_secret ?? "").trim();
    const legacyToken = (input.access_token ?? "").trim();
    const useInstalledApp = Boolean(input.use_installed_app);
    const shopDomain = normalizeShopDomain(input.shop_domain ?? "");
    if (!clientId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing client_id" }, correlationId }, { status: 400 });
    }
    if (!shopDomain) {
      return json({ ok: false, error: { code: "bad_request", message: "Enter a valid *.myshopify.com store domain" }, correlationId }, { status: 400 });
    }
    if (!(appClientId && appClientSecret) && !legacyToken && !useInstalledApp) {
      return json({ ok: false, error: { code: "bad_request", message: "Provide a Shopify Client ID and Client secret" }, correlationId }, { status: 400 });
    }

    // Determine the auth method and get an access token to verify + read shop
    // metadata. Options: reuse the offline token from the already-installed
    // promo-calendar app (installed_app), a Dev Dashboard client_credentials
    // grant (same-org only), or a pasted legacy admin token. installed_app and
    // legacy both persist a static admin token; client_credentials persists the
    // app secret and re-exchanges each run.
    let authMethod = appClientId && appClientSecret ? "client_credentials" : "admin_token";
    let accessToken = legacyToken;
    if (useInstalledApp) {
      authMethod = "admin_token";
      let token: string | null;
      try {
        token = await fetchInstalledAppToken(shopDomain, input.website_url);
      } catch (e) {
        return json({ ok: false, correlationId, error: { code: "config_missing", message: e instanceof Error ? e.message : "Installed-app lookup failed." } }, { status: 200 });
      }
      if (!token) {
        return json({ ok: false, correlationId, error: { code: "not_installed", message: `No token found for ${shopDomain} in the promo calendar app. Connect this store there first, then retry.` } }, { status: 200 });
      }
      accessToken = token;
    } else if (authMethod === "client_credentials") {
      const grant = await exchangeClientCredentials(shopDomain, appClientId, appClientSecret);
      if (!grant.ok) {
        return json(
          {
            ok: false,
            correlationId,
            error: {
              code: grant.status ? mapShopifyErrorCode(grant.status) : "token_exchange_failed",
              message: `Could not get an access token from Shopify (${grant.status || "network error"}): ${grant.error}. The client_credentials grant only works when the app and store are in the same Shopify organization.`,
              status: grant.status,
            },
          },
          { status: 200 },
        );
      }
      accessToken = grant.token;
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

    // Store the encrypted long-lived secret: the app client secret for the
    // client_credentials grant (re-exchanged each run), or the legacy admin
    // token. The short-lived exchanged token is never persisted.
    const secretToStore = authMethod === "client_credentials" ? appClientSecret : accessToken;
    const enc = await encryptString(secretToStore);
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
        auth_method: authMethod,
        app_client_id: authMethod === "client_credentials" ? appClientId : null,
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
