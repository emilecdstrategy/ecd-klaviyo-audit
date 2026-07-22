// Detect a store's real *.myshopify.com domain from its public storefront.
// Shopify storefronts expose the permanent domain in the page (Shopify.shop, the
// shopUrl monorail payload, or CDN/asset references), which the naive
// "strip the TLD" guess in the wizard cannot know. Best-effort; returns null if
// the site isn't a detectable Shopify storefront.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

function normalizeUrl(input: string): string | null {
  let raw = (input ?? "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return null;
  }
}

/** Pull the first plausible *.myshopify.com handle from storefront HTML. */
function extractMyshopifyDomain(html: string): string | null {
  // Most reliable: the Shopify.shop global or the shopId/permanent-domain payload.
  const patterns = [
    /Shopify\.shop\s*=\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i,
    /"shopDomain"\s*:\s*"([a-z0-9][a-z0-9-]*\.myshopify\.com)"/i,
    /"myshopifyDomain"\s*:\s*"([a-z0-9][a-z0-9-]*\.myshopify\.com)"/i,
    /permanent_domain["']?\s*[:=]\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].toLowerCase();
  }
  // Fallback: any *.myshopify.com token that isn't a CDN/asset host.
  const all = html.match(/\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/gi) ?? [];
  for (const candidate of all) {
    const host = candidate.toLowerCase();
    if (host.startsWith("cdn.") || host.startsWith("checkout.")) continue;
    return host;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  try {
    const { websiteUrl } = (await req.json()) as { websiteUrl?: string };
    const origin = normalizeUrl(websiteUrl ?? "");
    if (!origin) return json({ ok: false, error: "Invalid website URL" }, { status: 200 });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let html = "";
    try {
      const res = await fetch(origin, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; ECDAudit/1.0)", accept: "text/html" },
      });
      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }

    const domain = extractMyshopifyDomain(html);
    return json({ ok: true, domain: domain ?? null }, { status: 200 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Detection failed" }, { status: 200 });
  }
});
