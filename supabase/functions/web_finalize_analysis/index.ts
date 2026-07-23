import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { createLlmClient, type LlmImage, type LlmMessage } from "../_shared/llm-adapter.ts";
import {
  ANALYTICS_TOOL,
  coerceAnalytics,
  coerceOverview,
  coercePageAudit,
  coerceRoadmap,
  OVERVIEW_TOOL,
  PAGE_AUDIT_TOOL,
  ROADMAP_TOOL,
} from "../_shared/web-analysis-schemas.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEB_MODEL = "claude-sonnet-5";

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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Step =
  | { key: string; kind: "page"; page_type: string; label: string }
  | { key: string; kind: "analytics" | "overview" | "roadmap" };

const STEPS: Step[] = [
  { key: "web_homepage", kind: "page", page_type: "homepage", label: "homepage" },
  { key: "web_product_page", kind: "page", page_type: "product", label: "product page" },
  { key: "web_collection_page", kind: "page", page_type: "collection", label: "collection page" },
  { key: "web_cart", kind: "page", page_type: "cart", label: "cart" },
  { key: "web_performance", kind: "analytics" },
  { key: "web_overview", kind: "overview" },
  { key: "web_revenue_summary", kind: "roadmap" },
];

const WEB_SECTION_KEYS = STEPS.map((s) => s.key);

const SYSTEM_PROMPT = `You are a senior conversion-rate-optimization and UX auditor at ECD Digital Strategy, a digital agency for e-commerce brands. You audit Shopify storefronts from screenshots and store data and write findings for a client-facing report.

STYLE:
- Confident, concise, specific. Write like a senior strategist, not a brochure. No filler.
- Keep every finding and every recommendation to ONE short sentence (max ~16 words). Cut all non-essential words. The report shows them side by side with the screenshot, so brevity matters.
- NEVER use the em dash or en dash character. Use commas or periods. Plain hyphen for number ranges.
- Findings-only: describe what is wrong and what to change. Do NOT assign numeric scores.
- Ground every finding in what is actually visible in the screenshots or present in the data. Do not invent features, prices, or facts.

READING SCREENSHOTS:
- You receive labeled above-the-fold screenshots (IMG_1, IMG_2, ...), one or more per page (desktop and mobile). They show the top of the page as a visitor first sees it. Judge the page from what is visible; do not speculate about content below the fold.
- When you pinpoint an element with a highlight, the x/y/w/h are percentages (0-100) of THAT referenced image's dimensions (IMG_n), with a tight box around the element. Only add a highlight when you are confident where the element is, and reference the exact IMG_n it appears in. It is fine to omit the highlight.

COVERAGE:
- Every storefront page that rendered has concrete, specific UX and conversion issues worth flagging. For a page that rendered normally, return at least 3 findings and 2 to 4 strengths. Never return an empty audit for a page that rendered.

Call the provided tool exactly once with your result.`;

// Fire-and-forget the "after" image generation once analysis is complete. It
// self-chains one section per invocation, so we only need to kick it off. No-op
// if GEMINI_API_KEY is unset (the function returns not_configured).
async function triggerAfterGeneration(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/web_generate_after`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId, mode: "auto" }),
      }),
      sleep(2_000),
    ]);
  } catch {
    // best effort
  }
}

async function chainSelf(auditId: string, mode?: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/web_finalize_analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId, ...(mode ? { mode } : {}) }),
      }),
      sleep(3_000),
    ]);
  } catch {
    // best effort
  }
}

type SectionRow = {
  id: string;
  section_key: string;
  summary_text: string | null;
  section_details: Record<string, unknown> | null;
  section_config: Record<string, unknown> | null;
};

type ElementBox = { id: string; x: number; y: number; w: number; h: number; label?: string };

function buildPageImages(
  snaps: Array<{ id: string; viewport: string; variant: string; screenshot_url: string | null; elements?: ElementBox[] }>,
  pageLabel: string,
): {
  images: LlmImage[];
  refToId: Map<string, string>;
  refToElements: Map<string, ElementBox[]>;
  primaryId: string | null;
  elementsText: string;
} {
  // Only send viewport (above-the-fold) shots to the model: they are legible and
  // safely under Anthropic's 8000px image-dimension limit. Full-page shots (up to
  // 1440x12000) both exceed that limit and downscale to an illegible sliver, so
  // they are kept only for the report display, never sent to the model. Cart shots
  // are captured at viewport height under the 'full' variant, so fall back to them.
  const usable = snaps.filter((s) => s.screenshot_url);
  let chosen = usable.filter((s) => s.variant === "viewport");
  if (chosen.length === 0) chosen = usable;
  const rank = (s: { viewport: string }) => (s.viewport === "desktop" ? 0 : 1);
  const ordered = chosen.sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  const images: LlmImage[] = [];
  const refToId = new Map<string, string>();
  const refToElements = new Map<string, ElementBox[]>();
  const elementLines: string[] = [];
  ordered.forEach((s, i) => {
    const ref = `IMG_${i + 1}`;
    refToId.set(ref, s.id);
    images.push({ url: s.screenshot_url as string, label: `${ref}: ${pageLabel}, ${s.viewport}, above-the-fold` });
    const els = Array.isArray(s.elements) ? s.elements : [];
    if (els.length > 0) {
      refToElements.set(ref, els);
      const listed = els.slice(0, 60).map((e) => `${e.id} ${e.label ?? ""}`.trim()).join(" | ");
      elementLines.push(`${ref} elements: ${listed}`);
    }
  });
  const primaryId = ordered.find((s) => s.viewport === "desktop")?.id ?? ordered[0]?.id ?? null;
  const elementsText = elementLines.length
    ? `\n\nReal page elements detected on these screenshots (use element_id in a finding's highlight to pin exactly, it maps to the element's true on-page box):\n${elementLines.join("\n")}`
    : "";
  return { images, refToId, refToElements, primaryId, elementsText };
}

async function ensureJob(sb: ReturnType<typeof assertServiceClient>, auditId: string, clientId: string) {
  const { data: existing } = await sb.from("audit_analysis_jobs").select("*").eq("audit_id", auditId).maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb
    .from("audit_analysis_jobs")
    .insert({ audit_id: auditId, client_id: clientId, status: "pending", step_index: 0, partial_state: { web: true } })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function clearWebSections(sb: ReturnType<typeof assertServiceClient>, sections: SectionRow[]) {
  for (const s of sections) {
    if (!WEB_SECTION_KEYS.includes(s.section_key)) continue;
    const details = { ...(s.section_details ?? {}) };
    delete (details as Record<string, unknown>).web;
    delete (details as Record<string, unknown>).web_analytics;
    delete (details as Record<string, unknown>).web_roadmap;
    const config = { ...(s.section_config ?? {}) } as Record<string, unknown>;
    if (config[s.section_key] && typeof config[s.section_key] === "object") {
      const inner = { ...(config[s.section_key] as Record<string, unknown>) };
      delete inner.hidden;
      config[s.section_key] = inner;
    }
    await sb
      .from("audit_sections")
      .update({ summary_text: "", key_findings: { items: [], items_hidden: [] }, section_details: details, section_config: config })
      .eq("id", s.id);
  }
}

function hideConfig(section: SectionRow): Record<string, unknown> {
  const root = { ...(section.section_config ?? {}) } as Record<string, unknown>;
  const existing = (root[section.section_key] && typeof root[section.section_key] === "object")
    ? (root[section.section_key] as Record<string, unknown>)
    : {};
  root[section.section_key] = { ...existing, hidden: true };
  return root;
}

async function runStep(
  sb: ReturnType<typeof assertServiceClient>,
  llm: ReturnType<typeof createLlmClient>,
  auditId: string,
  step: Step,
  sections: SectionRow[],
) {
  const section = sections.find((s) => s.section_key === step.key);
  if (!section) return;

  if (step.kind === "page") {
    const { data: snaps } = await sb
      .from("web_page_snapshots")
      .select("id, viewport, variant, screenshot_url, elements")
      .eq("audit_id", auditId)
      .eq("page_type", step.page_type)
      .eq("status", "success");
    const rows = (snaps ?? []) as Array<{ id: string; viewport: string; variant: string; screenshot_url: string | null; elements?: ElementBox[] }>;
    if (rows.length === 0) {
      await sb.from("audit_sections").update({ section_config: hideConfig(section) }).eq("id", section.id);
      return;
    }
    const { images, refToId, refToElements, primaryId, elementsText } = buildPageImages(rows, step.label);
    const messages: LlmMessage[] = [{
      role: "user_images",
      text: `Audit the ${step.label} of this Shopify store using the screenshots above. Identify strengths, the most important issues (with a pinpoint highlight when you are confident of the element's location, referencing the correct IMG_n), and prioritized recommendations. Call record_page_audit exactly once.${elementsText}`,
      images,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [PAGE_AUDIT_TOOL], toolChoice: { type: "tool", name: "record_page_audit" } });
    if (turn.kind !== "tool_call") throw new Error(`${step.key}: model did not call the tool`);
    let parsed = coercePageAudit(turn.input, refToId, refToElements);
    // The model occasionally returns an empty audit for a page that clearly
    // rendered. Retry once with a firmer nudge before accepting nothing.
    if (parsed.findings.length === 0) {
      const retryMessages: LlmMessage[] = [{
        role: "user_images",
        text: `You returned no findings for the ${step.label}, but this page rendered normally and every storefront page has concrete UX and conversion issues. Look again at the screenshots above and identify at least 3 specific, visible issues, each with a recommendation, plus a few strengths. Call record_page_audit exactly once.${elementsText}`,
        images,
      }];
      const retry = await llm.runTurn({ system: SYSTEM_PROMPT, messages: retryMessages, tools: [PAGE_AUDIT_TOOL], toolChoice: { type: "tool", name: "record_page_audit" } });
      if (retry.kind === "tool_call") {
        const retryParsed = coercePageAudit(retry.input, refToId, refToElements);
        if (retryParsed.findings.length > 0) parsed = retryParsed;
      }
    }
    const details = { ...(section.section_details ?? {}) };
    (details as Record<string, unknown>).web = {
      pros: parsed.pros,
      findings: parsed.findings,
      primary_snapshot_id: primaryId,
    };
    await sb.from("audit_sections").update({
      summary_text: parsed.intro,
      key_findings: { items: parsed.recommendations, items_hidden: parsed.recommendations.map(() => false) },
      section_details: details,
    }).eq("id", section.id);
    return;
  }

  if (step.kind === "analytics") {
    const { data: rollup } = await sb
      .from("shopify_data_snapshots")
      .select("computed")
      .eq("audit_id", auditId)
      .eq("snapshot_kind", "orders_rollup")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const computed = (rollup?.computed ?? null) as Record<string, unknown> | null;
    if (!computed || !computed.current) {
      // No Shopify data: hide the analytics section.
      await sb.from("audit_sections").update({ section_config: hideConfig(section) }).eq("id", section.id);
      return;
    }
    const messages: LlmMessage[] = [{
      role: "user",
      text: `Here is the store's Shopify performance for the last 30 days vs the prior 30 days (numbers are authoritative; do not restate them, interpret them):\n\n${JSON.stringify(computed)}\n\nCall record_analytics_audit exactly once with an intro and one entry per relevant metric (commentary + recommendation).`,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [ANALYTICS_TOOL], toolChoice: { type: "tool", name: "record_analytics_audit" } });
    if (turn.kind !== "tool_call") throw new Error("analytics: model did not call the tool");
    const parsed = coerceAnalytics(turn.input);
    const details = { ...(section.section_details ?? {}) };
    (details as Record<string, unknown>).web_analytics = { timeframe_key: computed.timeframe_key ?? "30d_vs_prior_30d", metrics: parsed.metrics };
    await sb.from("audit_sections").update({ summary_text: parsed.intro, section_details: details }).eq("id", section.id);
    return;
  }

  if (step.kind === "overview") {
    const pageSections = sections.filter((s) => STEPS.find((st) => st.key === s.section_key && st.kind === "page"));
    const digest = pageSections.map((s) => {
      const web = (s.section_details?.web ?? {}) as { pros?: string[]; findings?: Array<{ text?: string }> };
      return `${s.section_key}: pros=${(web.pros ?? []).join("; ")} | issues=${(web.findings ?? []).map((f) => f.text).filter(Boolean).join("; ")}`;
    }).join("\n");
    const messages: LlmMessage[] = [{
      role: "user",
      text: `Below are the per-page audit results for this store. Write the report's opening: a short intro and an 'Overall Pros' list (the store's genuine strengths across pages). Call record_overview exactly once.\n\n${digest}`,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [OVERVIEW_TOOL], toolChoice: { type: "tool", name: "record_overview" } });
    if (turn.kind !== "tool_call") throw new Error("overview: model did not call the tool");
    const parsed = coerceOverview(turn.input);
    const details = { ...(section.section_details ?? {}) };
    (details as Record<string, unknown>).web = { pros: parsed.overall_pros, findings: [], primary_snapshot_id: null };
    await sb.from("audit_sections").update({ summary_text: parsed.intro, section_details: details }).eq("id", section.id);
    return;
  }

  // roadmap
  const { data: catalogRows } = await sb
    .from("revenue_opportunity_templates")
    .select("slug, name, one_time_price, one_time_label, monthly_price, monthly_label")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  const catalog = (catalogRows ?? []) as any[];
  const pageSections = sections.filter((s) => STEPS.find((st) => st.key === s.section_key && st.kind === "page"));
  const findingsDigest = pageSections.map((s) => {
    const web = (s.section_details?.web ?? {}) as { findings?: Array<{ text?: string; recommendation?: string }> };
    return (web.findings ?? []).map((f) => `- ${f.text}${f.recommendation ? ` (fix: ${f.recommendation})` : ""}`).join("\n");
  }).filter(Boolean).join("\n");
  const catalogList = catalog.map((c) => `- ${c.slug}: ${c.name}`).join("\n");
  const messages: LlmMessage[] = [{
    role: "user",
    text: `Turn these audit findings into a prioritized roadmap of work items. Match an item to a catalog service by slug when one clearly fits; otherwise set template_slug null. Do not state prices. Call record_roadmap exactly once.\n\nFINDINGS:\n${findingsDigest}\n\nCATALOG SERVICES (slug: name):\n${catalogList}`,
  }];
  const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [ROADMAP_TOOL], toolChoice: { type: "tool", name: "record_roadmap" } });
  if (turn.kind !== "tool_call") throw new Error("roadmap: model did not call the tool");
  const rows = coerceRoadmap(turn.input, catalog);
  const details = { ...(section.section_details ?? {}) };
  (details as Record<string, unknown>).web_roadmap = { rows };
  await sb.from("audit_sections").update({ section_details: details }).eq("id", section.id);
}

async function runPipeline(auditId: string, correlationId: string, mode?: string): Promise<Response> {
  const sb = assertServiceClient();
  const regenerate = mode === "regenerate";

  const { data: audit } = await sb.from("audits").select("id, client_id, audit_type").eq("id", auditId).maybeSingle();
  if (!audit) return json({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
  if (audit.audit_type !== "web") return json({ ok: true, correlationId, status: "skipped", reason: "not_web_audit" });

  const { data: sectionRows } = await sb
    .from("audit_sections")
    .select("id, section_key, summary_text, section_details, section_config")
    .eq("audit_id", auditId);
  const sections = (sectionRows ?? []) as SectionRow[];

  let job = await ensureJob(sb, auditId, audit.client_id as string);

  if (regenerate) {
    await clearWebSections(sb, sections);
    const { data: reset } = await sb
      .from("audit_analysis_jobs")
      .update({ status: "pending", step_index: 0, partial_state: { web: true }, error_message: null, updated_at: new Date().toISOString() })
      .eq("audit_id", auditId)
      .select("*")
      .single();
    job = reset ?? job;
  } else if (job.status === "complete") {
    return json({ ok: true, correlationId, status: "complete" });
  } else if (job.status === "failed") {
    const { data: reset } = await sb
      .from("audit_analysis_jobs")
      .update({ status: "pending", step_index: 0, error_message: null, updated_at: new Date().toISOString() })
      .eq("audit_id", auditId)
      .select("*")
      .single();
    job = reset ?? job;
  }

  // Guard against two overlapping runners (stale-running reset at 90s).
  const jobUpdatedMs = job.updated_at ? Date.parse(String(job.updated_at)) : 0;
  const stale = job.status === "running" && jobUpdatedMs > 0 && Date.now() - jobUpdatedMs >= 90_000;
  if (job.status === "running" && !stale) {
    return json({ ok: true, correlationId, status: "in_progress", reason: "already_running" });
  }

  let stepIndex = Number(job.step_index) || 0;
  if (stepIndex >= STEPS.length) {
    await sb.from("audit_analysis_jobs").update({ status: "complete", updated_at: new Date().toISOString() }).eq("audit_id", auditId);
    return json({ ok: true, correlationId, status: "complete" });
  }

  await sb.from("audit_analysis_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("audit_id", auditId);

  const llm = createLlmClient("anthropic", { model: WEB_MODEL });
  const step = STEPS[stepIndex];

  try {
    // Fresh sections read (so later steps see earlier steps' writes across chained invocations).
    const { data: freshRows } = await sb
      .from("audit_sections")
      .select("id, section_key, summary_text, section_details, section_config")
      .eq("audit_id", auditId);
    await runStep(sb, llm, auditId, step, (freshRows ?? []) as SectionRow[]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("audit_analysis_jobs").update({
      status: "failed",
      error_message: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({ ok: false, correlationId, status: "failed", error: msg }, { status: 200 });
  }

  const nextIndex = stepIndex + 1;
  const done = nextIndex >= STEPS.length;
  await sb.from("audit_analysis_jobs").update({
    status: done ? "complete" : "pending",
    step_index: nextIndex,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("audit_id", auditId);

  if (!done) await chainSelf(auditId, mode);
  else await triggerAfterGeneration(auditId);
  return json({ ok: true, correlationId, status: done ? "complete" : "in_progress", step: stepIndex, nextStep: nextIndex });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  const correlationId = crypto.randomUUID();
  let body: { audit_id?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Invalid JSON" }, correlationId }, { status: 400 });
  }
  const auditId = (body.audit_id ?? "").trim();
  if (!auditId) return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!isServiceRoleAuthorization(token)) {
    try {
      await getUserIdFromAuthorization(req);
    } catch (e) {
      return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
    }
  }

  try {
    return await runPipeline(auditId, correlationId, (body.mode ?? "").trim() || undefined);
  } catch (e) {
    return json({ ok: false, error: { code: "pipeline_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 500 });
  }
});
