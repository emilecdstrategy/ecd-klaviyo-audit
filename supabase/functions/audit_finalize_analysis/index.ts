import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization } from "../_shared/auth.ts";
import { persistAuditAnalysisResults } from "../_shared/audit-analysis-persist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SECTION_BATCHES: string[][] = [
  ["account_health"],
  ["flows"],
  ["segmentation"],
  ["campaigns"],
  ["email_design"],
  ["signup_forms"],
];

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function assertServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function auditContextHasContent(context: unknown): boolean {
  if (!context || typeof context !== "object") return false;
  const c = context as Record<string, unknown>;
  return Boolean(
    String(c.meeting_notes ?? "").trim() ||
      String(c.client_background ?? "").trim() ||
      String(c.custom_instructions ?? "").trim(),
  );
}

type StepKind = "top_level" | "section" | "refine" | "persist";

type StepDef = { kind: StepKind; keys?: string[] };

function buildStepPlan(hasRefine: boolean): StepDef[] {
  const steps: StepDef[] = [{ kind: "top_level" }];
  for (const keys of SECTION_BATCHES) steps.push({ kind: "section", keys });
  if (hasRefine) steps.push({ kind: "refine" });
  steps.push({ kind: "persist" });
  return steps;
}

async function chainSelf(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/audit_finalize_analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId }),
      }),
      sleep(4_000),
    ]);
  } catch {
    // best effort
  }
}

async function invokeAiAnalyze(body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai_analyze_audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.ok) {
    const msg = data?.error?.message ?? `AI request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function invokeAiWithRetry(body: Record<string, unknown>, label: string) {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await invokeAiAnalyze(body);
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /timeout|504|546|502|503|429|Failed to send/i.test(msg);
      if (!retryable || attempt === 3) break;
      await sleep(1500 + attempt * 1000);
    }
  }
  throw last instanceof Error ? last : new Error(`${label} failed`);
}

async function buildWizardData(sb: ReturnType<typeof assertServiceClient>, auditId: string) {
  const { data: audit, error: auditErr } = await sb
    .from("audits")
    .select("id, client_id, list_size, aov, monthly_traffic, context")
    .eq("id", auditId)
    .single();
  if (auditErr || !audit) throw auditErr ?? new Error("Audit not found");

  const { data: client, error: clientErr } = await sb
    .from("clients")
    .select("id, name, company_name, industry, esp_platform, website_url, notes")
    .eq("id", audit.client_id)
    .single();
  if (clientErr || !client) throw clientErr ?? new Error("Client not found");

  const { data: profileJob } = await sb
    .from("klaviyo_profile_scan_jobs")
    .select("status")
    .eq("audit_id", auditId)
    .maybeSingle();

  let profileAudienceScan: "full" | "skipped" | "timed_out" = "full";
  if (!profileJob || profileJob.status === "skipped") profileAudienceScan = "skipped";
  else if (profileJob.status === "complete") profileAudienceScan = "full";

  const context = audit.context ?? undefined;
  return {
    wizard: {
      auditId,
      clientId: client.id,
      clientName: client.name,
      companyName: client.company_name,
      industry: client.industry,
      espPlatform: client.esp_platform || "Klaviyo",
      websiteUrl: client.website_url || "",
      listSize: Math.round(Number(audit.list_size) || 0),
      aov: Math.round(Number(audit.aov) || 0),
      monthlyTraffic: Math.round(Number(audit.monthly_traffic) || 0),
      notes: client.notes || "",
      auditMethod: "api",
      auditContext: context,
      profileAudienceScan,
      clientSellsSubscriptions: Boolean((context as Record<string, unknown> | null)?.sells_subscriptions),
    },
    hasRefine: auditContextHasContent(context),
  };
}

async function ensureJob(sb: ReturnType<typeof assertServiceClient>, auditId: string, clientId: string) {
  const { data: existing } = await sb
    .from("audit_analysis_jobs")
    .select("*")
    .eq("audit_id", auditId)
    .maybeSingle();

  if (existing?.status === "complete") return { job: existing, created: false };
  if (existing) return { job: existing, created: false };

  const { data: inserted, error } = await sb
    .from("audit_analysis_jobs")
    .insert({
      audit_id: auditId,
      client_id: clientId,
      status: "pending",
      step_index: 0,
      partial_state: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return { job: inserted, created: true };
}

async function runPipeline(auditId: string, correlationId: string): Promise<Response> {
  const sb = assertServiceClient();

  const { data: audit, error: auditErr } = await sb
    .from("audits")
    .select("id, client_id, executive_summary, audit_method")
    .eq("id", auditId)
    .maybeSingle();
  if (auditErr) throw auditErr;
  if (!audit) return json({ ok: false, error: { code: "not_found", message: "Audit not found" }, correlationId }, { status: 404 });
  if (audit.audit_method !== "api") {
    return json({ ok: true, correlationId, status: "skipped", reason: "not_api_audit" });
  }
  if (String(audit.executive_summary ?? "").trim()) {
    await sb.from("audit_analysis_jobs").upsert({
      audit_id: auditId,
      client_id: audit.client_id,
      status: "complete",
      step_index: 999,
      partial_state: {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "audit_id" });
    return json({ ok: true, correlationId, status: "complete", reason: "already_analyzed" });
  }

  const { job: initialJob } = await ensureJob(sb, auditId, audit.client_id as string);
  let job = initialJob;
  if (job.status === "failed") {
    const { data: reset, error: resetErr } = await sb
      .from("audit_analysis_jobs")
      .update({
        status: "pending",
        step_index: 0,
        partial_state: {},
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("audit_id", auditId)
      .select("*")
      .single();
    if (resetErr) throw resetErr;
    job = reset!;
  }
  if (job.status === "complete") {
    return json({ ok: true, correlationId, status: "complete" });
  }

  const { wizard, hasRefine } = await buildWizardData(sb, auditId);
  const steps = buildStepPlan(hasRefine);
  const stepIndex = Number(job.step_index) || 0;

  if (stepIndex >= steps.length) {
    await sb.from("audit_analysis_jobs").update({
      status: "complete",
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({ ok: true, correlationId, status: "complete" });
  }

  await sb.from("audit_analysis_jobs").update({
    status: "running",
    updated_at: new Date().toISOString(),
  }).eq("audit_id", auditId);

  const partial = (job.partial_state ?? {}) as Record<string, unknown>;
  const step = steps[stepIndex];

  try {
    if (step.kind === "top_level") {
      const result = await invokeAiWithRetry({ ...wizard, requestedSectionKeys: [], aiMode: "top_level_only" }, "top-level");
      partial.executiveSummary = result.executiveSummary;
      partial.findings = result.findings ?? [];
      partial.strengths = result.strengths ?? [];
      partial.implementationTimeline = result.implementationTimeline ?? [];
      partial.sections = Array.isArray(partial.sections) ? partial.sections : [];
    } else if (step.kind === "section" && step.keys) {
      const result = await invokeAiWithRetry({
        ...wizard,
        requestedSectionKeys: step.keys,
        aiMode: "sections_only",
      }, `section ${step.keys.join(",")}`);
      const existing = Array.isArray(partial.sections) ? partial.sections as Array<Record<string, unknown>> : [];
      partial.sections = [...existing, ...(result.sections ?? [])];
    } else if (step.kind === "refine") {
      const sections = Array.isArray(partial.sections) ? partial.sections : [];
      const result = await invokeAiWithRetry({
        ...wizard,
        aiMode: "refine",
        refineBaseline: {
          companyName: wizard.companyName,
          clientName: wizard.clientName,
          executiveSummary: partial.executiveSummary,
          findings: partial.findings ?? [],
          strengths: partial.strengths ?? [],
          implementationTimeline: partial.implementationTimeline ?? [],
          sections,
        },
        auditContext: wizard.auditContext,
      }, "refine");
      partial.executiveSummary = result.executiveSummary;
      partial.findings = result.findings ?? partial.findings;
      partial.strengths = result.strengths ?? partial.strengths;
      partial.implementationTimeline = result.implementationTimeline ?? partial.implementationTimeline;
      if (Array.isArray(result.sections) && result.sections.length) {
        partial.sections = result.sections;
      }
    } else if (step.kind === "persist") {
      await persistAuditAnalysisResults(sb, auditId, {
        executiveSummary: String(partial.executiveSummary ?? ""),
        findings: (partial.findings as string[]) ?? [],
        strengths: (partial.strengths as string[]) ?? [],
        implementationTimeline: (partial.implementationTimeline as unknown[]) ?? [],
        sections: (partial.sections as Array<Record<string, unknown>>) ?? [],
      });
      await sb.from("audit_analysis_jobs").update({
        status: "complete",
        step_index: steps.length,
        partial_state: partial,
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("audit_id", auditId);
      return json({ ok: true, correlationId, status: "complete", step: stepIndex });
    }

    const nextIndex = stepIndex + 1;
    await sb.from("audit_analysis_jobs").update({
      status: nextIndex >= steps.length ? "complete" : "pending",
      step_index: nextIndex,
      partial_state: partial,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);

    if (nextIndex < steps.length) {
      await chainSelf(auditId);
    }

    return json({
      ok: true,
      correlationId,
      status: nextIndex >= steps.length ? "complete" : "in_progress",
      step: stepIndex,
      nextStep: nextIndex,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("audit_analysis_jobs").update({
      status: "failed",
      error_message: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({ ok: false, correlationId, status: "failed", error: msg }, { status: 200 });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  const correlationId = crypto.randomUUID();
  let body: { audit_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Invalid JSON" }, correlationId }, { status: 400 });
  }

  const auditId = (body.audit_id ?? "").trim();
  if (!auditId) {
    return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    try {
      await getUserIdFromAuthorization(req);
    } catch (e) {
      return json({
        ok: false,
        error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" },
        correlationId,
      }, { status: 401 });
    }
  }

  try {
    return await runPipeline(auditId, correlationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: { code: "pipeline_failed", message: msg }, correlationId }, { status: 500 });
  }
});
