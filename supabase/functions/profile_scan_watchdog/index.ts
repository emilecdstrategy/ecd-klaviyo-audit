/**
 * Scheduled worker: resumes stale Klaviyo profile scans and AI analysis jobs
 * without a browser tab open. Runs every 2 minutes via pg_cron.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STALE_AFTER_MS = 90_000;
const HIGHLIGHT_REGEN_STALE_AFTER_MS = 4 * 60 * 1000;

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function chainAuditFinalize(auditId: string, mode?: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  fetch(`${SUPABASE_URL}/functions/v1/audit_finalize_analysis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ audit_id: auditId, ...(mode ? { mode } : {}) }),
  }).catch(() => {});
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
  const [{ data: profileJobs, error: profileErr }, { data: aiJobs, error: aiErr }] = await Promise.all([
    sb
      .from("klaviyo_profile_scan_jobs")
      .select("audit_id, status, updated_at")
      .in("status", ["pending", "running"]),
    sb
      .from("audit_analysis_jobs")
      .select("audit_id, status, updated_at, step_index, partial_state")
      .in("status", ["pending", "running"]),
  ]);

  if (profileErr) {
    return json({ ok: false, error: profileErr.message }, { status: 500 });
  }
  if (aiErr && aiErr.code !== "PGRST205") {
    return json({ ok: false, error: aiErr.message }, { status: 500 });
  }

  const now = Date.now();
  let profileReset = 0;
  let profileResumed = 0;
  let aiReset = 0;
  let aiResumed = 0;

  for (const job of profileJobs ?? []) {
    const updatedMs = job.updated_at ? Date.parse(String(job.updated_at)) : 0;
    const stale = !updatedMs || now - updatedMs >= STALE_AFTER_MS;
    if (!stale) continue;

    if (job.status === "running") {
      await sb.from("klaviyo_profile_scan_jobs").update({
        status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("audit_id", job.audit_id);
      profileReset += 1;
    }

    chainResumeProfileScan(String(job.audit_id));
    profileResumed += 1;
  }

  for (const job of aiJobs ?? []) {
    const partial = (job.partial_state ?? {}) as Record<string, unknown>;
    const isHighlightRegen = partial.highlightRegen === true;
    const staleAfterMs = isHighlightRegen ? HIGHLIGHT_REGEN_STALE_AFTER_MS : STALE_AFTER_MS;
    const updatedMs = job.updated_at ? Date.parse(String(job.updated_at)) : 0;
    const stale = !updatedMs || now - updatedMs >= staleAfterMs;
    if (!stale) continue;

    if (job.status === "running") {
      await sb.from("audit_analysis_jobs").update({
        status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("audit_id", job.audit_id);
      aiReset += 1;
    }

    chainAuditFinalize(String(job.audit_id), isHighlightRegen ? "highlight_regen" : undefined);
    aiResumed += 1;
  }

  return json({
    ok: true,
    profile: { checked: profileJobs?.length ?? 0, reset: profileReset, resumed: profileResumed },
    ai: { checked: aiJobs?.length ?? 0, reset: aiReset, resumed: aiResumed },
  });
});
