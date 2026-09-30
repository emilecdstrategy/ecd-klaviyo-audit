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

/** How long a started install can be resumed from its saved credentials. */
const RESUME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 random bytes: the callback proves it belongs to this request by quoting
 *  it back, so it has to be unguessable. */
function newState(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
      /** "status": the client's latest install and how it ended. "resume": start
       *  that install again from its saved credentials. Default: a new install. */
      action?: "status" | "resume";
      client_id?: string;
      shop_domain?: string;
      app_client_id?: string;
      app_client_secret?: string;
      return_path?: string;
    };

    const clientId = (input.client_id ?? "").trim();

    if (input.action === "status" || input.action === "resume") {
      if (!clientId) return json({ ok: false, error: { code: "bad_request", message: "Missing client_id" }, correlationId }, { status: 400 });
      const sbr = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const since = new Date(Date.now() - RESUME_WINDOW_MS).toISOString();
      const { data: latest } = await sbr
        .from("shopify_oauth_installs")
        .select("shop_domain, app_client_id, app_secret_ciphertext, app_secret_iv, created_at, consumed_at, failed_reason, failed_at")
        .eq("client_id", clientId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (input.action === "status") {
        // Nothing secret leaves here: the store, when, and how it ended.
        return json({
          ok: true,
          install: latest
            ? {
              shop_domain: latest.shop_domain,
              started_at: latest.created_at,
              finished: Boolean(latest.consumed_at) && !latest.failed_reason,
              failed_reason: latest.failed_reason ?? null,
            }
            : null,
          correlationId,
        });
      }

      // Resume: a fresh single-use state carrying the same app credentials, so
      // nobody has to find and paste the Client secret a second time.
      if (!latest) {
        return json({ ok: false, error: { code: "not_found", message: "No install to resume. Enter the app credentials and start again." }, correlationId });
      }
      const state = newState();
      const { error: insertError } = await sbr.from("shopify_oauth_installs").insert({
        state,
        client_id: clientId,
        shop_domain: latest.shop_domain,
        app_client_id: latest.app_client_id,
        app_secret_ciphertext: latest.app_secret_ciphertext,
        app_secret_iv: latest.app_secret_iv,
        requested_by: uid,
        return_path: (input.return_path ?? "").slice(0, 500) || null,
      });
      if (insertError) throw insertError;
      return json({
        ok: true,
        authorize_url: authorizeUrl(latest.shop_domain as string, latest.app_client_id as string, state),
        correlationId,
      });
    }
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

    const state = newState();

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
