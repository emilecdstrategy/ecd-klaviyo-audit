// Shopify OAuth, the only way to read a store we do not own.
//
// The credentials flow already in the codebase exchanges an app's client id and
// secret for a token directly, which is quick but only works when the app and the
// store belong to the same Shopify organization. A prospect's store never does.
// Admin-created custom apps, the old paste-a-token route, can no longer be
// created at all. That leaves the authorization code grant: send the merchant to
// their own admin, they approve, Shopify calls us back with a code, we exchange it
// for a long-lived offline token.

/** What the audit actually reads. Requested up front so a scope gap never costs a
 * second install: read_customers is what makes repeat purchase possible, and
 * read_all_orders is what lets the window reach past 60 days. Both were missing
 * on stores connected earlier and each one cost a round trip with the client. */
export const OAUTH_SCOPES = [
  "read_orders",
  "read_all_orders",
  "read_products",
  "read_customers",
  "read_analytics",
] as const;

export function oauthScopeParam(): string {
  return OAUTH_SCOPES.join(",");
}

/** Where Shopify sends the merchant back. Fixed, because it has to be registered
 * on the app itself, and identical for every per-client app. */
export function callbackUrl(): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/shopify_oauth_callback`;
}

/** The consent screen URL. Nothing secret here: client id and redirect are public,
 * and `state` is the unguessable part that ties the callback to a pending row. */
export function authorizeUrl(shopDomain: string, appClientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appClientId,
    scope: oauthScopeParam(),
    redirect_uri: callbackUrl(),
    state,
    // Offline: a token that keeps working after the merchant closes the tab,
    // which is what a scheduled audit needs.
    "grant_options[]": "",
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Is this callback really from Shopify?
 *
 * Shopify signs the query string with the app secret. Without checking it, anyone
 * who guessed the callback URL could post a shop and a code of their choosing, so
 * this is the difference between an install flow and an open redirect that writes
 * to our database. The signature covers every parameter except hmac itself, sorted
 * by key.
 */
export async function verifyHmac(url: URL, appSecret: string): Promise<boolean> {
  const provided = url.searchParams.get("hmac") ?? "";
  if (!provided) return false;

  const pairs: string[] = [];
  for (const [key, value] of [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  const message = pairs.join("&");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const computed = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(computed, provided.toLowerCase());
}

/** Constant-time comparison, so a wrong signature cannot be narrowed down by
 *  timing how long the rejection took. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only ever redirect the merchant to a real Shopify store domain. */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.toLowerCase());
}

/** Trade the one-time code for a long-lived offline access token. */
export async function exchangeCode(
  shopDomain: string,
  appClientId: string,
  appSecret: string,
  code: string,
): Promise<{ ok: true; token: string; scope: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: appClientId, client_secret: appSecret, code }),
    });
  } catch (e) {
    return { ok: false, error: `token_request_failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: `token_exchange_http_${res.status}: ${JSON.stringify(body).slice(0, 200)}` };
  }
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (!token) return { ok: false, error: "token_exchange_no_token" };
  return { ok: true, token, scope: typeof body?.scope === "string" ? body.scope : "" };
}
