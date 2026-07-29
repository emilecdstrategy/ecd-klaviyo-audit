import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { completeAuthorization, serviceClient } from "../_shared/xero.ts";

// Xero redirects the BROWSER here after consent, so this is a GET with no auth
// header of its own. The state parameter is the one-time token we stored when
// starting the flow; it both proves the request came from us and tells us which
// admin connected. Always ends in a redirect back to Settings so the person sees
// the outcome in the app rather than raw JSON.

const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

function redirect(status: "connected" | "error", detail?: string, tenant?: string) {
  const base = APP_URL || "https://audit.ecdigitalstrategy.com";
  // The Xero panel lives on the proposals Settings tab; there is no /settings route.
  const qs = new URLSearchParams({ tab: "settings", xero: status });
  if (detail) qs.set("xero_detail", detail.slice(0, 200));
  if (tenant) qs.set("xero_org", tenant.slice(0, 120));
  return new Response(null, {
    status: 302,
    headers: { location: `${base}/proposals?${qs.toString()}` },
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirect("error", oauthError);
  if (!code || !state) return redirect("error", "Missing code or state");

  try {
    const sb = serviceClient();
    // Single-use state, and it must be recent: this is what stops a replayed or
    // forged callback from attaching someone else's Xero org.
    const { data: stateRow } = await sb
      .from("xero_oauth_states")
      .select("state, created_by, created_at")
      .eq("state", state)
      .maybeSingle();
    if (!stateRow) return redirect("error", "This connection link has expired. Start again from Settings.");
    await sb.from("xero_oauth_states").delete().eq("state", state);
    if (Date.now() - Date.parse(stateRow.created_at as string) > 15 * 60 * 1000) {
      return redirect("error", "This connection link has expired. Start again from Settings.");
    }

    const { tenantName } = await completeAuthorization(sb, code, (stateRow.created_by as string) ?? null);
    return redirect("connected", undefined, tenantName);
  } catch (e) {
    return redirect("error", e instanceof Error ? e.message : "Could not connect to Xero");
  }
});
