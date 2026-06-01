/**
 * Scheduled worker: resumes stale Klaviyo profile scans without a browser tab open.
 * Runs every 2 minutes via Supabase cron (see config.toml).
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STALE_AFTER_MS = 90_000;

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function chainResumeProfileScan(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  fetch(`${SUPABASE_URL}/functions/v1/klaviyo_fetch_snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ stage: "resume_profile_scan", audit_id: auditId }),
  }).catch(() => {});
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!isServiceRoleAuthorization(token)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Missing Supabase env" }, { status: 500 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: jobs, error } = await sb
    .from("klaviyo_profile_scan_jobs")
    .select("audit_id, status, updated_at")
    .in("status", ["pending", "running"]);

  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  const now = Date.now();
  let reset = 0;
  let resumed = 0;

  for (const job of jobs ?? []) {
    const updatedMs = job.updated_at ? Date.parse(String(job.updated_at)) : 0;
    const stale = !updatedMs || now - updatedMs >= STALE_AFTER_MS;
    if (!stale) continue;

    if (job.status === "running") {
      await sb.from("klaviyo_profile_scan_jobs").update({
        status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("audit_id", job.audit_id);
      reset += 1;
    }

    chainResumeProfileScan(String(job.audit_id));
    resumed += 1;
  }

  return json({ ok: true, checked: jobs?.length ?? 0, reset, resumed });
});
