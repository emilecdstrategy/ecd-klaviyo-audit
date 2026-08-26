// Begins a Shopify OAuth install for one client's store.
//
// Stores what the callback will need (which ECD client, which store, and the app
// secret to verify and exchange with) and hands back the consent URL. The secret
// is written encrypted and the row is single-use.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptString } from "../_shared/crypto.ts";
import { requireStaffUserId } from "../_shared/auth.ts";
import { normalizeShopDomain } from "../_shared/shopify-api.ts";
import { authorizeUrl, callbackUrl, oauthScopeParam } from "../_shared/shopify-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, accept",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...corsHeaders, ...(init?.headers ?? {}) },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();

  try {
    // Staff only: this writes an app secret and starts a flow that grants access
    // to a merchant's store.
    let uid: string;
    try {
      uid = await requireStaffUserId(req, "audits");
    } catch (e) {
      return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
    }

    const input = (await req.json()) as {
      client_id?: string;
      shop_domain?: string;
      app_client_id?: string;
      app_client_secret?: string;
      return_path?: string;
    };

    const clientId = (input.client_id ?? "").trim();
    const shopDomain = normalizeShopDomain(input.shop_domain ?? "");
    const appClientId = (input.app_client_id ?? "").trim();
    const appSecret = (input.app_client_secret ?? "").trim();

    if (!clientId) return json({ ok: false, error: { code: "bad_request", message: "Missing client_id" }, correlationId }, { status: 400 });
    // normalizeShopDomain returns null for anything that is not a real
    // *.myshopify.com host, so its null IS the validation failure.
    if (!shopDomain) {
      return json({ ok: false, error: { code: "bad_request", message: "Enter the store's .myshopify.com domain" }, correlationId }, { status: 400 });
    }
    if (!appClientId || !appSecret) {
      return json({ ok: false, error: { code: "bad_request", message: "Enter the app's Client ID and Client secret" }, correlationId }, { status: 400 });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 32 random bytes: the callback proves it belongs to this request by quoting
    // it back, so it has to be unguessable.
    const state = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const enc = await encryptString(appSecret);
    const { error } = await sb.from("shopify_oauth_installs").insert({
      state,
      client_id: clientId,
      shop_domain: shopDomain,
      app_client_id: appClientId,
      app_secret_ciphertext: enc.ciphertext,
      app_secret_iv: enc.iv,
      requested_by: uid,
      return_path: (input.return_path ?? "").slice(0, 500) || null,
    });
    if (error) throw error;

    return json({
      ok: true,
      authorize_url: authorizeUrl(shopDomain, appClientId, state),
      callback_url: callbackUrl(),
      scopes: oauthScopeParam(),
      correlationId,
    });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
