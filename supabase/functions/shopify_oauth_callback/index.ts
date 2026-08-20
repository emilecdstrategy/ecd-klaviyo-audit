// Where Shopify sends the merchant after they approve the install.
//
// Arrives as a bare GET from the merchant's browser, so everything it needs comes
// from the query string plus the pending row that shopify_oauth_start wrote. It
// verifies the request is genuinely Shopify's, exchanges the code for a long-lived
// token, stores the connection, and bounces the merchant back into the app.
//
// This endpoint is public by necessity, which is exactly why the HMAC check is not
// optional: without it, anyone who found the URL could name a shop and have us
// write a connection for it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptString, encryptString } from "../_shared/crypto.ts";
import { SHOPIFY_API_VERSION, normalizeShopDomain, shopifyRest } from "../_shared/shopify-api.ts";
import { exchangeCode, isValidShopDomain, verifyHmac } from "../_shared/shopify-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_ORIGIN = (Deno.env.get("APP_PUBLIC_ORIGIN") ?? "https://audit.ecdigitalstrategy.com").replace(/\/$/, "");

/** How long a started install stays valid. Long enough for a merchant to read the
 *  consent screen and find their password, short enough that a leaked state is
 *  not useful tomorrow. */
const INSTALL_TTL_MS = 30 * 60 * 1000;

/** Send the merchant back into the app with the outcome in the URL, so the page
 *  they land on can say what happened instead of silently re-testing. */
function backToApp(path: string, params: Record<string, string>): Response {
  const url = new URL(path || "/audits/new", APP_ORIGIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const shopParam = (url.searchParams.get("shop") ?? "").toLowerCase();

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Nothing below can be trusted until the pending row and the HMAC agree, so
  // failures here deliberately say little and write nothing.
  if (!state || !code || !isValidShopDomain(shopParam)) {
    return backToApp("/audits/new", { shopify_install: "failed", reason: "bad_request" });
  }

  const { data: pending } = await sb
    .from("shopify_oauth_installs")
    .select("state, client_id, shop_domain, app_client_id, app_secret_ciphertext, app_secret_iv, return_path, created_at, consumed_at")
    .eq("state", state)
    .maybeSingle();

  if (!pending) return backToApp("/audits/new", { shopify_install: "failed", reason: "unknown_state" });
  const returnPath = pending.return_path || "/audits/new";

  // Single use, and expiring: a replayed callback must not mint a second token.
  if (pending.consumed_at) return backToApp(returnPath, { shopify_install: "failed", reason: "already_used" });
  if (Date.now() - new Date(pending.created_at as string).getTime() > INSTALL_TTL_MS) {
    return backToApp(returnPath, { shopify_install: "failed", reason: "expired" });
  }
  // The shop that came back must be the shop we sent them to.
  const shopDomain = normalizeShopDomain(String(pending.shop_domain ?? ""));
  if (!shopDomain || normalizeShopDomain(shopParam) !== shopDomain) {
    return backToApp(returnPath, { shopify_install: "failed", reason: "shop_mismatch" });
  }

  try {
    const appSecret = await decryptString(
      pending.app_secret_ciphertext as string,
      pending.app_secret_iv as string,
    );

    if (!(await verifyHmac(url, appSecret))) {
      return backToApp(returnPath, { shopify_install: "failed", reason: "bad_signature" });
    }

    // Burn the row before spending the code, so a duplicated callback cannot run
    // the exchange twice even if the two arrive together.
    const { data: claimed } = await sb
      .from("shopify_oauth_installs")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state)
      .is("consumed_at", null)
      .select("state")
      .maybeSingle();
    if (!claimed) return backToApp(returnPath, { shopify_install: "failed", reason: "already_used" });

    const granted = await exchangeCode(shopDomain, pending.app_client_id as string, appSecret, code);
    if (!granted.ok) {
      return backToApp(returnPath, { shopify_install: "failed", reason: "exchange_failed" });
    }

    // Confirm the token actually reads the store before claiming a connection.
    const shopRes = await shopifyRest(shopDomain, granted.token, "/shop.json");
    if (!shopRes.ok) {
      return backToApp(returnPath, { shopify_install: "failed", reason: "verify_failed" });
    }
    const shop = shopRes.body?.shop ?? {};

    const clientId = pending.client_id as string;

    // One store belongs to one client: silently repointing a store at a second
    // client would split its audit history in two.
    const { data: clash } = await sb
      .from("shopify_connections")
      .select("client_id")
      .eq("shop_domain", shopDomain)
      .neq("client_id", clientId)
      .maybeSingle();
    if (clash?.client_id) {
      return backToApp(returnPath, { shopify_install: "failed", reason: "shop_taken" });
    }

    const enc = await encryptString(granted.token);
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

    // Scopes recorded from what Shopify says it granted, rather than from what we
    // asked for: the two differ whenever an app config lags behind the request,
    // and a report that claims a metric it cannot read is worse than one that
    // explains the gap.
    const grantedScopes = granted.scope
      ? granted.scope.split(",").map((s) => s.trim()).filter(Boolean).sort()
      : [];

    await sb.from("shopify_connections").upsert(
      {
        client_id: clientId,
        shop_domain: shopDomain,
        shop_id: shop.id != null ? String(shop.id) : null,
        shop_name: shop.name ?? null,
        currency: shop.currency ?? null,
        timezone: shop.iana_timezone ?? shop.timezone ?? null,
        plan_name: shop.plan_display_name ?? shop.plan_name ?? null,
        // Deliberately not "client_credentials": the stored secret here is a
        // usable offline token, so the fetchers must use it directly rather than
        // trying to exchange it for another one.
        auth_method: "oauth",
        app_client_id: pending.app_client_id as string,
        api_version: SHOPIFY_API_VERSION,
        scopes: { granted: grantedScopes, checked_at: new Date().toISOString() },
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );

    await sb.from("clients").update({ shopify_connected: true }).eq("id", clientId);

    const primaryDomain = shop.domain ? `https://${shop.domain}` : null;
    if (primaryDomain) {
      const { data: existing } = await sb.from("clients").select("website_url").eq("id", clientId).maybeSingle();
      if (!(existing?.website_url ?? "").trim()) {
        await sb.from("clients").update({ website_url: primaryDomain }).eq("id", clientId);
      }
    }

    return backToApp(returnPath, {
      shopify_install: "ok",
      shop: shopDomain,
      shop_name: String(shop.name ?? ""),
    });
  } catch {
    return backToApp(returnPath, { shopify_install: "failed", reason: "server_error" });
  }
});
