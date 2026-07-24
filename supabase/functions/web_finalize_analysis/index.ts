import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { createLlmClient, type LlmImage, type LlmMessage } from "../_shared/llm-adapter.ts";
import { FINDINGS_GUARDRAILS, CRO_HEURISTICS } from "../_shared/ecommerce-ux-kb.ts";
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

VOICE (this is the most important part):
- Write like a sharp, friendly senior strategist talking directly to the store's founder, NOT a QA engineer filing bugs. Confident, warm, plain English.
- Lead each recommendation with the ACTION, then the payoff for the shopper or brand, in one natural breath. Shape: "Do X. It gives shoppers/the brand Y."
- Be concrete. When it is about wording, propose the actual words (a real headline, a real button label). When it is about layout, name the actual change.
- NO jargon. Never use terms like "tap target", "44px", "above the fold", "viewport", "placeholder", "CTA", "CRO", "UX", "visual hierarchy", "friction", "conversion funnel". Explain it the way you would to a smart non-technical founder: say "button" not "CTA element", "the top of the page" not "above the fold", "on phones" not "mobile viewport".
- The FINDING is ONE short sentence naming the opportunity. The RECOMMENDATION is 1-2 sentences in the voice above.
- NEVER use the em dash or en dash character. Use commas or periods.
- No numeric scores. Ground everything in what is actually visible; never invent features, prices, product names, or facts.

WHAT TO PRIORITIZE (lead with the biggest, most visible wins, in roughly this order):
1. Clarity of what the store sells and why to buy it, the instant the page loads (the headline and hero image/message).
2. One obvious, compelling primary button that gives a first-time visitor an easy first step.
3. Helping shoppers find products fast (clear navigation, quick category shortcuts).
4. Trust and proof (reviews, star ratings, a customer quote, guarantees) placed where they reassure at the right moment.
5. Making the announcement bar and header earn their space (pair an offer with a next step; keep search and cart easy to reach).
Favor these high-leverage, shopper-facing improvements over small technical nitpicks. Every recommendation must be realistic to ship on Shopify (theme settings/sections, a reputable app, or standard build work) and stay on-brand, never gimmicky.

CRO HEURISTICS (apply these to sharpen findings and recommendations):
${CRO_HEURISTICS}

EXAMPLES of the quality and voice to match (do NOT copy verbatim, adapt to THIS store):
- "Make the announcement bar do more than state the perk. Pair the free-shipping offer with a 'Shop now' link so visitors get the deal and their next step in one glance."
- "Lead with a hero image that shows your products in their real world, so shoppers instantly understand what you sell."
- "Tighten the headline to say plainly what you help customers do, instead of a clever slogan."
- "Give the hero one clear, full-width button like 'Shop best sellers' so new visitors have an obvious first step."
- "Add a short customer quote under the button to build trust before shoppers start browsing."

READING SCREENSHOTS:
- You receive labeled screenshots (IMG_1, IMG_2, ...), one or more per page (desktop and phone). They show the top of the page as a visitor first sees it. Judge the page from what is visible; do not speculate about content further down.
- When you pinpoint an element with a highlight, the x/y/w/h are percentages (0-100) of THAT referenced image's dimensions (IMG_n), with a tight box around the element. Reference the exact IMG_n it appears in.

GUARDRAILS (do not violate these):
${FINDINGS_GUARDRAILS}

COVERAGE:
- Every storefront page that rendered has real, specific opportunities worth flagging. For a page that rendered normally, return at least 3 findings and 2 to 4 strengths, leading with the ones that would move the needle most. Never return an empty audit for a page that rendered.

Call the provided tool exactly once with your result.`;

// Fire-and-forget the "after" image generation once analysis is complete. It
// self-chains one section per invocation, so we only need to kick it off. No-op
// if GEMINI_API_KEY is unset (the function returns not_configured).
async function triggerAfterGeneration(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    // Mark afters as pending so the report waits until they finish generating.
    try {
      const sb = assertServiceClient();
      await sb.from("audits").update({ web_afters_ready: false }).eq("id", auditId);
    } catch { /* non-fatal */ }
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
  refToViewport: Map<string, string>;
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
  const refToViewport = new Map<string, string>();
  const elementLines: string[] = [];
  ordered.forEach((s, i) => {
    const ref = `IMG_${i + 1}`;
    refToId.set(ref, s.id);
    refToViewport.set(ref, s.viewport);
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
    ? `\n\nReal page elements detected on these screenshots (use element_id in a finding's highlight to pin exactly, it maps to the element's true on-page box). ALWAYS prefer element_id over x/y/w/h: your coordinate estimates land pins on the wrong element, while these boxes are exact. If you truly must fall back to coordinates, word the highlight's label using the same wording as the closest listed element so it can still be matched:\n${elementLines.join("\n")}`
    : "";
  return { images, refToId, refToElements, refToViewport, primaryId, elementsText };
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
  extraInstruction?: string,
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
    const { images, refToId, refToElements, refToViewport, primaryId, elementsText } = buildPageImages(rows, step.label);
    const messages: LlmMessage[] = [{
      role: "user_images",
      text: `Audit the ${step.label} of this store using the screenshots above, in the founder-friendly voice and priorities from your instructions. You have both desktop and phone shots. Tag each finding with the device it applies to (desktop, mobile, or both), and surface what matters on each: the phone and desktop experiences differ, so aim for a healthy mix, not only 'both'. Lead with the biggest wins (what they sell and why, the hero message and image, one clear primary button, easy product discovery, trust and proof), and only then smaller polish. Give almost every finding highlights so it shows a numbered pin on the screenshots: add one entry to the finding's highlights array PER image it is visible on, using element_id from that image's listed elements when one fits. For a 'both' finding, pin it on BOTH the desktop IMG and the matching mobile IMG (the same element on each device) so the pin appears on both viewports. Only skip highlights when a point has no single spot on screen. Return strengths, the most important opportunities, and prioritized recommendations. Call record_page_audit exactly once.${extraInstruction ? `\n\nThe strategist specifically asked for this regeneration: ${extraInstruction}. Prioritize that while still covering the biggest wins.` : ""}${elementsText}`,
      images,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [PAGE_AUDIT_TOOL], toolChoice: { type: "tool", name: "record_page_audit" } });
    if (turn.kind !== "tool_call") throw new Error(`${step.key}: model did not call the tool`);
    let parsed = coercePageAudit(turn.input, refToId, refToElements, refToViewport);
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
        const retryParsed = coercePageAudit(retry.input, refToId, refToElements, refToViewport);
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
    .in("audit_type", ["web", "both"]) // web audit: only web + both services
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
    // Re-invoking a finished audit is a safe way to (re)kick "after" generation
    // for any section/viewport still missing one (idempotent: it skips existing).
    await triggerAfterGeneration(auditId);
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

  // IMPORTANT: never propagate `mode` to the continuation. `regenerate` must only
  // reset (clear sections + step_index=0) on the FIRST invocation; passing it to
  // every chained hop makes each hop reset to 0, looping the pipeline forever.
  if (!done) await chainSelf(auditId);
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
  const mode = (body.mode ?? "").trim();

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!isServiceRoleAuthorization(token)) {
    try {
      await getUserIdFromAuthorization(req);
    } catch (e) {
      return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
    }
  }

  // Regenerate a SINGLE page section's findings (used by the web-audit assistant),
  // optionally steered by a strategist instruction. Synchronous, no job/chain.
  if (mode === "regenerate_section") {
    const b = body as { section_key?: string; instruction?: string };
    const sectionKey = (b.section_key ?? "").trim();
    const step = STEPS.find((s) => s.key === sectionKey && s.kind === "page");
    if (!step) return json({ ok: false, error: { code: "bad_request", message: "Unknown or non-page section_key" }, correlationId }, { status: 400 });
    try {
      const sb = assertServiceClient();
      const { data: rows } = await sb
        .from("audit_sections")
        .select("id, section_key, summary_text, section_details, section_config")
        .eq("audit_id", auditId);
      const sectionsList = (rows ?? []) as SectionRow[];
      const llm = createLlmClient("anthropic", { model: WEB_MODEL });
      await runStep(sb, llm, auditId, step, sectionsList, b.instruction?.trim() || undefined);
      return json({ ok: true, correlationId, status: "complete", section: sectionKey });
    } catch (e) {
      return json({ ok: false, error: { code: "regenerate_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 200 });
    }
  }

  try {
    return await runPipeline(auditId, correlationId, mode || undefined);
  } catch (e) {
    return json({ ok: false, error: { code: "pipeline_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 500 });
  }
});
