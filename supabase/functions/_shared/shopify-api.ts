/** Shopify Admin API helpers shared by the web-audit edge functions. */

export const SHOPIFY_API_VERSION = "2026-04";

/** Normalizes user input like "https://my-store.myshopify.com/admin" to "my-store.myshopify.com". */
export function normalizeShopDomain(input: string): string | null {
  let raw = (input ?? "").trim().toLowerCase();
  if (!raw) return null;
  raw = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw.includes(".")) raw = `${raw}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(raw)) return null;
  return raw;
}

/**
 * Exchange a Dev Dashboard app's client id + secret for a short-lived (24h)
 * Admin API access token via the client_credentials grant. This replaces the
 * retired legacy custom-app "paste a shpat_ token" flow. NOTE: Shopify only
 * honors this grant when the app and the store are in the SAME Shopify org.
 */
export type ClientCredentialsResult =
  | { ok: true; token: string; scope: string; expiresIn: number }
  | { ok: false; status: number; error: string };

export async function exchangeClientCredentials(
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<ClientCredentialsResult> {
  let res: Response;
  try {
    res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error" };
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok || !body?.access_token) {
    const detail = (body && typeof body === "object" ? (body.error_description || body.error) : null) || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: String(detail) };
  }
  return {
    ok: true,
    token: String(body.access_token),
    scope: String(body.scope ?? ""),
    expiresIn: Number(body.expires_in ?? 0),
  };
}

export async function shopifyRest(shopDomain: string, accessToken: string, path: string) {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    headers: {
      accept: "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body: body as any };
}

export async function shopifyGraphql(shopDomain: string, accessToken: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok && !body?.errors, status: res.status, body };
}

export function mapShopifyErrorCode(status: number): string {
  if (status === 401) return "invalid_token";
  if (status === 403) return "insufficient_scope";
  if (status === 404) return "shop_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unknown_error";
}
