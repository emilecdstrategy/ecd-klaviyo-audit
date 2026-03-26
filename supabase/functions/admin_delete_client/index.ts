import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function serviceClient(authHeader?: string | null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
  });
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing Authorization header");
  const sb = serviceClient(authHeader);
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Unauthorized");
  const uid = data.user.id;
  const { data: profile, error: pErr } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (pErr) throw pErr;
  if (profile?.role !== "admin") throw new Error("Forbidden");
  return { uid };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await requireAdmin(req);
    const { client_id } = (await req.json()) as { client_id?: string };
    const clientId = (client_id ?? "").trim();
    if (!clientId) return json({ ok: false, error: { code: "bad_request", message: "Missing client_id" }, correlationId }, { status: 400 });

    const sb = serviceClient();

    // Gather audit ids for this client
    const { data: audits, error: aErr } = await sb.from("audits").select("id").eq("client_id", clientId);
    if (aErr) throw aErr;
    const auditIds = (audits ?? []).map((a: any) => a.id).filter(Boolean);

    // Delete in dependency order
    if (auditIds.length) {
      // annotations depend on audit_sections
      const { data: sectionIds } = await sb.from("audit_sections").select("id").in("audit_id", auditIds);
      const secIds = (sectionIds ?? []).map((s: any) => s.id).filter(Boolean);
      if (secIds.length) await sb.from("annotations").delete().in("audit_section_id", secIds);

      await sb.from("audit_assets").delete().in("audit_id", auditIds);
      await sb.from("audit_sections").delete().in("audit_id", auditIds);
      await sb.from("recommendations").delete().in("audit_id", auditIds);
      await sb.from("flow_performance").delete().in("audit_id", auditIds);
      await sb.from("health_scores").delete().in("audit_id", auditIds);

      await sb.from("klaviyo_flow_snapshots").delete().in("audit_id", auditIds);
      await sb.from("klaviyo_campaign_snapshots").delete().in("audit_id", auditIds);
      await sb.from("klaviyo_form_snapshots").delete().in("audit_id", auditIds);
      await sb.from("klaviyo_segment_snapshots").delete().in("audit_id", auditIds);
      await sb.from("klaviyo_reporting_rollups").delete().in("audit_id", auditIds);

      await sb.from("audits").delete().in("id", auditIds);
    }

    // Client-scoped tables
    await sb.from("client_secrets").delete().eq("client_id", clientId);
    await sb.from("klaviyo_connections").delete().eq("client_id", clientId);

    // Finally delete the client
    const { error: cErr } = await sb.from("clients").delete().eq("id", clientId);
    if (cErr) throw cErr;

    return json({ ok: true, correlationId }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});

