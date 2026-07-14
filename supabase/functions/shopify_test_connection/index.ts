import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { normalizeShopDomain, shopifyRest, mapShopifyErrorCode, SHOPIFY_API_VERSION } from "../_shared/shopify-api.ts";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  try {
    const { shopDomain: rawDomain, accessToken } = (await req.json()) as { shopDomain?: string; accessToken?: string };
    if (!accessToken || typeof accessToken !== "string") return json({ error: "Missing accessToken" }, { status: 400 });
    const shopDomain = normalizeShopDomain(rawDomain ?? "");
    if (!shopDomain) return json({ error: "Enter a valid *.myshopify.com store domain" }, { status: 400 });

    const shopRes = await shopifyRest(shopDomain, accessToken, "/shop.json");
    if (!shopRes.ok) {
      return json({
        ok: false,
        apiVersion: SHOPIFY_API_VERSION,
        error: {
          code: mapShopifyErrorCode(shopRes.status),
          message: "Failed shop access",
          status: shopRes.status,
        },
      }, { status: 200 });
    }

    const ordersRes = await shopifyRest(shopDomain, accessToken, "/orders/count.json?status=any");
    const productsRes = await shopifyRest(shopDomain, accessToken, "/products/count.json");

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
        !ordersRes.ok ? `Orders scope may be missing (${ordersRes.status}). Enable read_orders on the custom app.` : null,
        !productsRes.ok ? `Products scope may be missing (${productsRes.status}). Enable read_products on the custom app.` : null,
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
