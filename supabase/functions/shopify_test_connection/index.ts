import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { normalizeShopDomain, shopifyRest, mapShopifyErrorCode, exchangeClientCredentials, fetchInstalledAppToken, SHOPIFY_API_VERSION } from "../_shared/shopify-api.ts";

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  try {
    const { shopDomain: rawDomain, accessToken, clientId, clientSecret, useInstalledApp, websiteUrl } = (await req.json()) as {
      shopDomain?: string;
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
      useInstalledApp?: boolean;
      websiteUrl?: string;
    };
    const shopDomain = normalizeShopDomain(rawDomain ?? "");
    if (!shopDomain) return json({ error: "Enter a valid *.myshopify.com store domain" }, { status: 400 });

    // Resolve an access token. Preferred: reuse the offline token from the app
    // already installed on the store (installed_app). Otherwise a Dev Dashboard
    // client_credentials grant, or a pasted legacy admin token.
    let accessTokenResolved = "";
    if (useInstalledApp) {
      const token = await fetchInstalledAppToken(shopDomain, websiteUrl);
      if (!token) {
        return json({
          ok: false,
          apiVersion: SHOPIFY_API_VERSION,
          error: { code: "not_installed", message: `No token found for ${shopDomain} in the promo calendar app. Connect this store there first, then retry.` },
        }, { status: 200 });
      }
      accessTokenResolved = token;
    } else if (clientId && clientSecret) {
      const grant = await exchangeClientCredentials(shopDomain, clientId.trim(), clientSecret.trim());
      if (!grant.ok) {
        const sameOrgHint =
          " The client_credentials grant only works when the app and the store are in the same Shopify organization. If this is a client's store, the app must be installed there (OAuth) instead.";
        return json({
          ok: false,
          apiVersion: SHOPIFY_API_VERSION,
          error: {
            code: grant.status ? mapShopifyErrorCode(grant.status) : "token_exchange_failed",
            message: `Could not get an access token from Shopify (${grant.status || "network error"}): ${grant.error}. Check the Client ID, Client secret, and store domain.${sameOrgHint}`,
            status: grant.status,
          },
        }, { status: 200 });
      }
      accessTokenResolved = grant.token;
    } else if (accessToken && typeof accessToken === "string") {
      accessTokenResolved = accessToken.trim();
    } else {
      return json({ error: "Provide a Client ID and Client secret (or a legacy access token)" }, { status: 400 });
    }
    const accessTokenFinal = accessTokenResolved;

    const shopRes = await shopifyRest(shopDomain, accessTokenFinal, "/shop.json");
    if (!shopRes.ok) {
      const code = mapShopifyErrorCode(shopRes.status);
      let message: string;
      if (code === "invalid_token" || code === "insufficient_scope") {
        message = `Shopify accepted the credentials but the token cannot read the shop (${shopRes.status}). Add the read_products, read_orders and read_analytics scopes to the app, then try again.`;
      } else if (code === "shop_not_found") {
        message = `Store not found (404). Check the store domain, it must be the real .myshopify.com domain for this store (currently ${shopDomain}).`;
      } else if (code === "rate_limited") {
        message = "Shopify rate limited the request (429). Wait a moment and try again.";
      } else if (code === "provider_unavailable") {
        message = `Shopify is temporarily unavailable (${shopRes.status}). Try again shortly.`;
      } else {
        message = `Failed shop access (${shopRes.status}).`;
      }
      return json({
        ok: false,
        apiVersion: SHOPIFY_API_VERSION,
        error: { code, message, status: shopRes.status },
      }, { status: 200 });
    }

    const ordersRes = await shopifyRest(shopDomain, accessTokenFinal, "/orders/count.json?status=any");
    const productsRes = await shopifyRest(shopDomain, accessTokenFinal, "/products/count.json");

    const shop = shopRes.body?.shop ?? null;
    return json({
      ok: true,
      apiVersion: SHOPIFY_API_VERSION,
      shop: shop
        ? {
            id: shop.id ?? null,
            name: shop.name ?? null,
            domain: shopDomain,
            currency: shop.currency ?? null,
            timezone: shop.iana_timezone ?? null,
            plan: shop.plan_display_name ?? null,
          }
        : null,
      scopeChecks: {
        shopRead: shopRes.ok,
        ordersRead: ordersRes.ok,
        productsRead: productsRes.ok,
      },
      warnings: [
        !ordersRes.ok ? `Orders scope may be missing (${ordersRes.status}). Add read_orders to the app's Admin API scopes.` : null,
        !productsRes.ok ? `Products scope may be missing (${productsRes.status}). Add read_products to the app's Admin API scopes.` : null,
      ].filter(Boolean),
    }, { status: 200 });
  } catch (e) {
    return json({
      ok: false,
      error: {
        code: "request_failed",
        message: e instanceof Error ? e.message : "Unknown error",
      },
    }, { status: 200 });
  }
});
