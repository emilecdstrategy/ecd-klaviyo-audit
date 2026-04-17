import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireAdminUserId } from "../_shared/auth.ts";

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

async function mustSucceed(promise: PromiseLike<{ error: unknown }>, context: string) {
  const res = await promise;
  if ((res as any).error) throw new Error(`${context}: ${(res as any).error?.message ?? "unknown error"}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await requireAdminUserId(req);
    const { audit_id } = (await req.json()) as { audit_id?: string };
    const auditId = (audit_id ?? "").trim();
    if (!auditId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceRoleClient();

    // Single delete: child tables use ON DELETE CASCADE (or SET NULL for klaviyo_runs.audit_id).
    await mustSucceed(sb.from("audits").delete().eq("id", auditId), "Delete audit");

    return json({ ok: true, correlationId }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});

