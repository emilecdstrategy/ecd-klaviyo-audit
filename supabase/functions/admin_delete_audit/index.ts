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

async function mustSucceed(promise: PromiseLike<{ error: unknown }>, context: string) {
  const res = await promise;
  if ((res as any).error) throw new Error(`${context}: ${(res as any).error?.message ?? "unknown error"}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await requireAdmin(req);
    const { audit_id } = (await req.json()) as { audit_id?: string };
    const auditId = (audit_id ?? "").trim();
    if (!auditId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });
    }

    const sb = serviceClient();

    const { data: sectionRows, error: sectionErr } = await sb.from("audit_sections").select("id").eq("audit_id", auditId);
    if (sectionErr) throw sectionErr;
    const sectionIds = (sectionRows ?? []).map((s: any) => s.id).filter(Boolean);

    if (sectionIds.length) {
      await mustSucceed(sb.from("annotations").delete().in("audit_section_id", sectionIds), "Delete annotations");
    }

    await mustSucceed(sb.from("audit_assets").delete().eq("audit_id", auditId), "Delete audit_assets");
    await mustSucceed(sb.from("audit_sections").delete().eq("audit_id", auditId), "Delete audit_sections");
    await mustSucceed(sb.from("recommendations").delete().eq("audit_id", auditId), "Delete recommendations");
    await mustSucceed(sb.from("flow_performance").delete().eq("audit_id", auditId), "Delete flow_performance");
    await mustSucceed(sb.from("health_scores").delete().eq("audit_id", auditId), "Delete health_scores");
    await mustSucceed(sb.from("klaviyo_flow_snapshots").delete().eq("audit_id", auditId), "Delete klaviyo_flow_snapshots");
    await mustSucceed(sb.from("klaviyo_campaign_snapshots").delete().eq("audit_id", auditId), "Delete klaviyo_campaign_snapshots");
    await mustSucceed(sb.from("klaviyo_form_snapshots").delete().eq("audit_id", auditId), "Delete klaviyo_form_snapshots");
    await mustSucceed(sb.from("klaviyo_segment_snapshots").delete().eq("audit_id", auditId), "Delete klaviyo_segment_snapshots");
    await mustSucceed(sb.from("klaviyo_reporting_rollups").delete().eq("audit_id", auditId), "Delete klaviyo_reporting_rollups");
    await mustSucceed(sb.from("audits").delete().eq("id", auditId), "Delete audit");

    return json({ ok: true, correlationId }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});

