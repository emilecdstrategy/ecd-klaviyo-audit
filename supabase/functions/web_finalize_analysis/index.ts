import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { createLlmClient, type LlmImage, type LlmMessage } from "../_shared/llm-adapter.ts";
import { FINDINGS_GUARDRAILS, CRO_HEURISTICS } from "../_shared/ecommerce-ux-kb.ts";
import { afterImagesEnabled } from "../_shared/after-images-enabled.ts";
import { autoPublishAudit } from "../_shared/auto-publish.ts";
import {
  ANALYTICS_TOOL,
  coerceAnalytics,
  coerceOverview,
  coercePageAudit,
  coerceRoadmap,
  isNearDuplicateFinding,
  sitewideTopic,
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

// The announcement bar, header, main nav and footer are the same on every page,
// so they are audited once on the homepage. Other pages get told to skip them,
// otherwise the same "group the nav categories" finding (and the same header
// change in the after-image) is repeated on every section.
const GLOBAL_CHROME_NOTE =
  " IMPORTANT SCOPE RULE: the announcement bar, the header, the main navigation, the footer, and any floating widgets (chat bubble, loyalty or rewards badge, back-to-top button) are shared sitewide and are already audited on the homepage section of this report. Do NOT write any finding about them here, even if you see something worth improving. Focus only on what is specific to THIS page's own content and layout.";

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
- Every storefront page that rendered has real, specific opportunities worth flagging. For a page that rendered normally, return 3 to 6 findings and 2 to 4 strengths, leading with the ones that would move the needle most. Three is a floor, not a target: most pages deserve four or five. Never return an empty audit for a page that rendered.

Call the provided tool exactly once with your result.`;

// Fire-and-forget the "after" image generation once analysis is complete. It
// self-chains one section per invocation, so we only need to kick it off. No-op
// if GEMINI_API_KEY is unset (the function returns not_configured).
async function triggerAfterGeneration(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  // Afters off: analysis is the last step, so it inherits what the after-image
  // chain used to own at the end of the pipeline. Do NOT set
  // web_afters_ready = false here, or the report stays gated and the pg_cron
  // watchdog keeps re-kicking a phase that is switched off (it selects audits
  // on exactly that flag).
  if (!afterImagesEnabled()) {
    try {
      const sb = assertServiceClient();
      await sb.from("audits").update({ web_afters_ready: true }).eq("id", auditId);
      await autoPublishAudit(sb, auditId);
    } catch { /* non-fatal: a human can still publish by hand */ }
    return;
  }
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

/** The inverse, applied whenever a page section is successfully written.
 *
 * Hiding is sticky: it survives in section_config until something clears it, so
 * a section hidden on one pass (its screenshots had not landed yet) stayed
 * invisible even after a later pass analysed it perfectly. Re-analysing a page
 * is exactly the proof that it exists, so publishing findings must also undo the
 * hide, or recovering an audit means editing the database by hand. */
function unhideConfig(section: SectionRow): Record<string, unknown> {
  const root = { ...(section.section_config ?? {}) } as Record<string, unknown>;
  const existing = (root[section.section_key] && typeof root[section.section_key] === "object")
    ? (root[section.section_key] as Record<string, unknown>)
    : null;
  if (!existing) return root;
  const next = { ...existing };
  delete next.hidden;
  root[section.section_key] = next;
  return root;
}

// Nothing logged what the model actually returned, so a section could ship with
// an empty findings list leaving no trace of whether the model said nothing or
// the coercer threw it all away. These two record exactly that distinction.
function logAuditShape(stepKey: string, pass: string, input: unknown) {
  const o = (input ?? {}) as Record<string, unknown>;
  const shape = (v: unknown) => (Array.isArray(v) ? `array(${v.length})` : v === undefined ? "absent" : typeof v);
  const firstFinding = Array.isArray(o.findings) ? o.findings[0] : null;
  console.log(JSON.stringify({
    event: "page_audit_shape",
    step: stepKey,
    pass,
    keys: Object.keys(o),
    intro: shape(o.intro),
    pros: shape(o.pros),
    findings: shape(o.findings),
    recommendations: shape(o.recommendations),
    finding_keys: firstFinding && typeof firstFinding === "object" ? Object.keys(firstFinding as Record<string, unknown>) : null,
  }));
}

function logCoercionLoss(stepKey: string, pass: string, input: unknown, kept: number) {
  const o = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(o.findings) ? o.findings.length : 0;
  if (raw === 0 || kept > 0) return;
  console.log(JSON.stringify({
    event: "page_audit_coercion_dropped_all",
    step: stepKey,
    pass,
    raw_count: raw,
    sample: JSON.stringify(o.findings).slice(0, 1500),
  }));
}

async function runStep(
  sb: ReturnType<typeof assertServiceClient>,
  llm: ReturnType<typeof createLlmClient>,
  auditId: string,
  step: Step,
  sections: SectionRow[],
  extraInstruction?: string,
  /** Client background, call notes and focus instructions. Steering only. */
  contextBlock = "",
) {
  const section = sections.find((s) => s.section_key === step.key);
  if (!section) return;

  if (step.kind === "page") {
    // Read EVERY row for this page, not just the successful ones, so "not
    // captured yet" can be told apart from "this page does not exist". Hiding is
    // permanent and silent, so it must only ever answer the second case.
    const { data: snaps } = await sb
      .from("web_page_snapshots")
      .select("id, viewport, variant, screenshot_url, elements, status, url, raw")
      .eq("audit_id", auditId)
      .eq("page_type", step.page_type);
    const allRows = (snaps ?? []) as Array<
      {
        id: string;
        viewport: string;
        variant: string;
        screenshot_url: string | null;
        elements?: ElementBox[];
        status: string;
        url?: string | null;
        raw?: Record<string, unknown> | null;
      }
    >;
    // Belt and braces behind the capture gate in runWebPipeline: if a shot for
    // this page is still pending, leave the section completely alone (not hidden,
    // not written) and let the capture chain's completion kick run it properly.
    if (allRows.some((r) => r.status === "pending")) {
      throw new Error(`${step.key}: screenshots for this page are still being captured`);
    }
    const rows = allRows.filter((r) => r.status === "success" && r.screenshot_url);
    if (rows.length === 0) {
      await sb.from("audit_sections").update({ section_config: hideConfig(section) }).eq("id", section.id);
      return;
    }

    // A CART SHOT THAT IS NOT A CART IS NOT AUDITABLE. The cart capture adds a
    // product and opens the drawer; when a storefront's bot protection blocks
    // that (Power Planter answered five retries with "your connection needs to
    // be verified"), the fallback screenshot is just the homepage. Auditing it
    // produced a "Cart" section that opened by admitting it was looking at the
    // home view and then repeated a homepage finding, which reads to the client
    // as a broken report. cart_count is the honest signal: a real drawer capture
    // records the number of items it added, and a /cart URL means we are on the
    // cart page even if the count went unrecorded. Neither one: hide the
    // section rather than describe the wrong page.
    if (step.page_type === "cart") {
      const filled = allRows.some((r) => Number((r.raw ?? {}).cart_count ?? 0) > 0);
      const onCartUrl = allRows.some((r) => /\/cart(\/|$|\?)/.test(String(r.url ?? "")));
      if (!filled && !onCartUrl) {
        console.log(`${step.key}: cart never populated (no cart_count, not a /cart URL), hiding the section`);
        await sb.from("audit_sections").update({ section_config: hideConfig(section) }).eq("id", section.id);
        return;
      }
    }
    const { images, refToId, refToElements, refToViewport, primaryId, elementsText } = buildPageImages(rows, step.label);

    // Memory of what earlier page sections already reported. Sitewide furniture
    // (header, nav, announcement bar, floating chat/loyalty widgets) looks the
    // same on every page, so without this each section re-flags it and the reader
    // sees the same point four times.
    const myIndex = STEPS.findIndex((s) => s.key === step.key);
    const priorFindings: string[] = [];
    const priorTopics = new Set<string>();
    for (let i = 0; i < myIndex; i++) {
      const prev = STEPS[i];
      if (prev.kind !== "page") continue;
      const prevSection = sections.find((s) => s.section_key === prev.key);
      const prevWeb = (prevSection?.section_details?.web ?? {}) as { findings?: Array<{ text?: string }> };
      for (const f of prevWeb.findings ?? []) {
        const t = (f.text ?? "").trim();
        if (!t) continue;
        priorFindings.push(t);
        const topic = sitewideTopic(t);
        if (topic) priorTopics.add(topic);
      }
    }
    const priorText = priorFindings.length
      ? `\n\nALREADY REPORTED earlier in this same audit, on other pages of this store. Do NOT repeat any of these, and do NOT restate the same issue in different words. Anything sitewide (the announcement bar, header, main navigation, footer, floating chat or loyalty widgets) is covered once and must not be raised again here:\n${priorFindings.map((t) => `- ${t}`).join("\n")}`
      : "";
    const messages: LlmMessage[] = [{
      role: "user_images",
      text: `Audit the ${step.label} of this store using the screenshots above, in the founder-friendly voice and priorities from your instructions. You have both desktop and phone shots. Tag each finding with the device it applies to (desktop, mobile, or both), and surface what matters on each: the phone and desktop experiences differ, so aim for a healthy mix, not only 'both'. Lead with the biggest wins (what they sell and why, the hero message and image, one clear primary button, easy product discovery, trust and proof), and only then smaller polish. Give almost every finding highlights so it shows a numbered pin on the screenshots: add one entry to the finding's highlights array PER image it is visible on, using element_id from that image's listed elements when one fits. For a 'both' finding, pin it on BOTH the desktop IMG and the matching mobile IMG (the same element on each device) so the pin appears on both viewports. Only skip highlights when a point has no single spot on screen. ALWAYS write the intro field first: it is this section's summary paragraph in the report, 2-3 sentences on where this page stands, what it does well, and what is holding it back. Never leave it blank. Then return strengths, the most important opportunities, and prioritized recommendations. Call record_page_audit exactly once.${step.page_type === "homepage" ? "" : GLOBAL_CHROME_NOTE}${priorText}${extraInstruction ? `\n\nThe strategist specifically asked for this regeneration: ${extraInstruction}. Prioritize that while still covering the biggest wins.` : ""}${contextBlock}${elementsText}`,
      images,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [PAGE_AUDIT_TOOL], toolChoice: { type: "tool", name: "record_page_audit" } });
    if (turn.kind !== "tool_call") throw new Error(`${step.key}: model did not call the tool`);
    logAuditShape(step.key, "first", turn.input);
    let parsed = coercePageAudit(turn.input, refToId, refToElements, refToViewport);
    logCoercionLoss(step.key, "first", turn.input, parsed.findings.length);
    // The model sometimes returns an empty audit for a page that clearly
    // rendered, and it often skips the intro entirely (which left the report's
    // section summary blank). Retry once for whichever piece is missing.
    const MIN_FINDINGS = 3;
    const MAX_FINDINGS = 6;
    const needFindings = parsed.findings.length === 0;
    // A page can clear "not empty" and still be thin: a product page came back
    // with 2 findings, both tagged "both", so every per-viewport count was 2 and
    // the thin-viewport retry below never fired even though the page looked bare.
    const tooFew = !needFindings && parsed.findings.length < MIN_FINDINGS;
    const needIntro = !parsed.intro.trim();
    // Trim the tail rather than the head: the model is told to lead with the
    // highest-impact findings, and the after-image cap is 6 anyway, so anything
    // past this could never be shown in a concept image.
    if (parsed.findings.length > MAX_FINDINGS) parsed.findings = parsed.findings.slice(0, MAX_FINDINGS);
    // A page can pass the "not empty" check and still be nearly empty on ONE
    // device, because the report shows a single viewport at a time. Three
    // findings all tagged desktop leaves the mobile reader looking at one.
    const countFor = (vp: "desktop" | "mobile") =>
      parsed.findings.filter((f) => f.viewport === vp || f.viewport === "both").length;
    const thinViewport: "desktop" | "mobile" | null = needFindings
      ? null
      : countFor("mobile") < 2
        ? "mobile"
        : countFor("desktop") < 2
          ? "desktop"
          : null;
    if (needFindings || needIntro || thinViewport || tooFew) {
      // Ask for EVERYTHING that is missing. This was a ternary chain whose
      // first branches were guarded by `&& !needIntro`, so a page that came
      // back with too few findings AND no intro fell through to the intro-only
      // ask, which even told the model to keep the findings it already gave.
      // A live homepage shipped with 1 finding, no recommendations and a blank
      // summary because of exactly that.
      const needs: string[] = [];
      if (needFindings) {
        needs.push(`at least ${MIN_FINDINGS} specific, visible findings, each with a recommendation and tagged with the viewport it applies to`);
      } else if (tooFew) {
        needs.push(`your existing ${parsed.findings.length} finding(s) PLUS enough new ones to reach at least ${MIN_FINDINGS} (four or five is normal), each with a recommendation and a viewport tag`);
      } else if (thinViewport) {
        needs.push(`your existing findings PLUS at least two more that genuinely apply to ${thinViewport}, each tagged "${thinViewport}" (or "both" when it truly affects both), each with a recommendation`);
      }
      if (needIntro) {
        needs.push(`the intro: 2-3 sentences in the founder-friendly voice on where this page stands, what it does well, and what is holding it back`);
      }
      const keepNote = needs.length === 1 && needIntro
        ? " Keep the same findings and recommendations you already gave."
        : "";
      const ask =
        `Your audit of the ${step.label} came back incomplete. This page rendered normally and every storefront page has concrete UX and conversion issues worth raising. Return ${
          needs.join(" AND ")
        }. Do not pad with vague advice: only real issues you can point at in the screenshot.${keepNote}`;
      const retryMessages: LlmMessage[] = [{
        role: "user_images",
        text: `${ask} Call record_page_audit exactly once.${contextBlock}${elementsText}`,
        images,
      }];
      const retry = await llm.runTurn({ system: SYSTEM_PROMPT, messages: retryMessages, tools: [PAGE_AUDIT_TOOL], toolChoice: { type: "tool", name: "record_page_audit" } });
      if (retry.kind === "tool_call") {
        logAuditShape(step.key, "retry", retry.input);
        const retryParsed = coercePageAudit(retry.input, refToId, refToElements, refToViewport);
        logCoercionLoss(step.key, "retry", retry.input, retryParsed.findings.length);
        // Only take what was actually missing, so a retry cannot throw away good
        // findings from the first pass. `tooFew` is handled alongside
        // `needFindings`: it was absent here, so a retry that genuinely added
        // findings to a thin page was computed and then discarded.
        if ((needFindings || tooFew) && retryParsed.findings.length > parsed.findings.length) {
          parsed = {
            ...retryParsed,
            intro: retryParsed.intro.trim() ? retryParsed.intro : parsed.intro,
          };
        } else if (needIntro && retryParsed.intro.trim() && !parsed.intro.trim()) {
          parsed = { ...parsed, intro: retryParsed.intro };
        } else if (thinViewport) {
          // Keep the better-covered pass. The retry was asked to return the old
          // findings plus more, but if it came back thinner, the first pass wins.
          const before = parsed.findings.filter((f) => f.viewport === thinViewport || f.viewport === "both").length;
          const after = retryParsed.findings.filter((f) => f.viewport === thinViewport || f.viewport === "both").length;
          if (after > before) parsed = { ...retryParsed, intro: retryParsed.intro.trim() ? retryParsed.intro : parsed.intro };
          if (needIntro && !parsed.intro.trim() && retryParsed.intro.trim()) parsed = { ...parsed, intro: retryParsed.intro };
        } else if (needIntro && retryParsed.intro.trim()) parsed = { ...parsed, intro: retryParsed.intro };
      }
    }
    // A page section with no findings renders in the client's report as a
    // heading, a screenshot and nothing else, and the after-image step then runs
    // with zero fixes to make, so the After looks identical to the Before. Until
    // now the pipeline wrote that and published it. Two passes have already been
    // spent here, so fail the step instead: the run pauses with a Resume button
    // and the watchdog picks it up, which is recoverable in a way a silently
    // blank section never was.
    // The bar is a section a client can actually read: at least one finding AND
    // a summary paragraph. Checking only for zero findings let a homepage ship
    // with one finding, no recommendations and a blank summary, which reads as
    // broken even though it technically had content.
    if (parsed.findings.length === 0 || !parsed.intro.trim()) {
      throw new Error(
        `${step.key}: incomplete after both passes (${parsed.findings.length} finding(s), ${
          parsed.intro.trim() ? "intro present" : "no intro"
        }), so the section was left untouched rather than published half-empty`,
      );
    }

    // Enforce the memory in code: the prompt asks the model not to repeat, but it
    // still does, so drop anything that restates an earlier section's finding or
    // re-raises a sitewide topic already covered. Only enforced when this page has
    // enough findings left to stay useful.
    let deduped = parsed.findings.filter((f) => {
      const topic = sitewideTopic(f.text);
      if (topic && priorTopics.has(topic)) return false;
      return !isNearDuplicateFinding(f.text, priorFindings);
    });
    if (deduped.length === 0) deduped = parsed.findings; // never blank a whole page

    const details = { ...(section.section_details ?? {}) };
    (details as Record<string, unknown>).web = {
      pros: parsed.pros,
      findings: deduped,
      primary_snapshot_id: primaryId,
    };
    // Never blank an existing summary: if the model returned no intro this pass,
    // keep whatever the section already had rather than writing an empty string.
    const nextSummary = parsed.intro?.trim() ? parsed.intro : (section.summary_text ?? "");
    await sb.from("audit_sections").update({
      summary_text: nextSummary,
      key_findings: { items: parsed.recommendations, items_hidden: parsed.recommendations.map(() => false) },
      section_details: details,
      // This page demonstrably exists and now has findings, so lift any hide left
      // behind by an earlier pass that could not see its screenshots.
      section_config: unhideConfig(section),
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
    // The free-shipping threshold, lifted from what the storefront itself says.
    // It is the missing half of the strongest AOV play: lazyleaf asks $100 while
    // nine orders in ten land under $78, so the incentive is unreachable for
    // almost every shopper. Shopify's API will not tell us the threshold (it
    // lives in shipping settings, and read_shipping is not granted), but the
    // announcement bar and the cart drawer both print it, and we already
    // captured that text.
    const thresholdNote = await (async () => {
      try {
        const { data: snaps } = await sb
          .from("web_page_snapshots")
          .select("elements")
          .eq("audit_id", auditId)
          .eq("status", "success");
        const amounts = new Set<string>();
        for (const row of snaps ?? []) {
          for (const el of ((row.elements ?? []) as ElementBox[])) {
            const label = String(el.label ?? "");
            if (!/free\s*ship/i.test(label)) continue;
            const m = label.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/);
            if (m) amounts.add(m[1].replace(/,/g, ""));
          }
        }
        if (amounts.size === 0) return "";
        return `The storefront advertises free shipping at these amounts (read off its own announcement bar and cart): ${[...amounts].map((a) => "$" + a).join(", ")}. Compare that with basket.order_value_percentiles before suggesting a threshold change.`;
      } catch {
        return "";
      }
    })();
    const messages: LlmMessage[] = [{
      role: "user",
      text: [
        `Backend data for this store, straight from its Shopify admin. Every figure is authoritative. The report shows the headline numbers as cards already, so do NOT narrate them back.`,
        JSON.stringify(computed),
        thresholdNote,
        `Return 2 to 5 PLAYS via record_analytics_audit: things this team could ship this month to raise average order value, protect margin, or make the catalogue work harder. Rules:`,
        `- Each play quotes a real figure from the data above. Never invent or round a number into something the data does not say.`,
        `- basket.window_days tells you the window the basket figures came from; say it in the play's window field, and never present a 90 or 180 day pattern as this month's behaviour.`,
        `- basket.frequent_pairs is the ONLY evidence for a "bundle these" play. When it is empty, no two products were bought together often enough to justify one, so do not suggest a specific bundle; a play about raising basket size in general is still fair if single_item_order_share supports it.`,
        `- If basket.confident is false there were too few orders to trust the basket figures: say so plainly in that play's insight rather than dressing thin data as a pattern.`,
        `- basket.order_history_limited true means Shopify only returned the last 60 days (the store's app lacks the read_all_orders scope), so basket.window_days is all the history there was. Never imply a longer trend than that.`,
        `- basket.top_products is ranked by REVENUE, and each entry carries both its revenue and its units, so never call the first one the best seller by volume unless its units say so.`,
        `- Name real products when the data names them, and ALSO list their exact titles in the play's products array: the report turns each into a card with the product's real photo, price and a link to its live page. Copy the title character for character from the data, or the card cannot be built. A play showing the actual products is worth three that only describe them.`,
        `- Every product you name anywhere in the play, including inside an action step, MUST also appear in that play's products array. A step that says "feature X as the add-on for Y" and lists only X leaves the reader looking at half the idea.`,
        `- A play about pairing, cross-selling, add-ons, bundling or raising basket size names BOTH sides: the driver to attach to and the item to attach, so 2 or 3 products, not 1. With frequent_pairs empty, pick them from top_products yourself and say why they belong together, for example the highest-revenue line as the driver and a low-price high-unit line as the add-on.`,
        `- Fill the window field on every play. It is the period the figure covers, and the report prints it under the headline number.`,
        `- Skip a lever with nothing to say. Three sharp plays beat five padded ones.`,
        `- One play per lever. If two plays would name the same products and ask for the same work, keep the stronger one and drop the other.`,
        `- The intro is ONE sentence. Findings about the storefront's design belong to other sections; this one is strictly about what the order data reveals.`,
      ].filter(Boolean).join("\n\n") + contextBlock,
    }];
    const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [ANALYTICS_TOOL], toolChoice: { type: "tool", name: "record_analytics_audit" } });
    if (turn.kind !== "tool_call") throw new Error("analytics: model did not call the tool");
    logAuditShape("web_performance", "analytics", turn.input);
    const parsed = coerceAnalytics(turn.input);
    // Same distinction the page steps log: did the model return nothing, or did
    // the coercer discard what it returned? Without this, "plays: []" in the
    // database is unattributable, which is exactly where the last hour went.
    console.log(
      `web_performance: model returned ${Array.isArray((turn.input as { plays?: unknown[] })?.plays) ? ((turn.input as { plays?: unknown[] }).plays as unknown[]).length : 0} play(s), ${parsed.plays.length} kept`,
    );
    const details = { ...(section.section_details ?? {}) };
    (details as Record<string, unknown>).web_analytics = {
      timeframe_key: computed.timeframe_key ?? "30d_vs_prior_30d",
      plays: parsed.plays,
      metrics: parsed.metrics,
    };
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
      text: `Below are the per-page audit results for this store. Write the report's opening: a short intro and an 'Overall Pros' list (the store's genuine strengths across pages). Call record_overview exactly once.${contextBlock}\n\n${digest}`,
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
    text: `Turn these audit findings into a prioritized roadmap of work items. Match an item to a catalog service by slug when one clearly fits; otherwise set template_slug null. Do not state prices. Call record_roadmap exactly once.${contextBlock}\n\nFINDINGS:\n${findingsDigest}\n\nCATALOG SERVICES (slug: name):\n${catalogList}`,
  }];
  const turn = await llm.runTurn({ system: SYSTEM_PROMPT, messages, tools: [ROADMAP_TOOL], toolChoice: { type: "tool", name: "record_roadmap" } });
  if (turn.kind !== "tool_call") throw new Error("roadmap: model did not call the tool");
  const rows = coerceRoadmap(turn.input, catalog);
  const details = { ...(section.section_details ?? {}) };
  (details as Record<string, unknown>).web_roadmap = { rows };
  await sb.from("audit_sections").update({ section_details: details }).eq("id", section.id);
}

/** What the strategist told us about this client, plus the facts we already
 * hold, formatted for the analysis prompts.
 *
 * The web analysis used to run blind: it never read audits.context and its
 * system prompt is a fixed string, so it did not know the client's name, what
 * they sell, or anything said in the kickoff call. Two auditors, one briefed and
 * one not, produced identical reports.
 *
 * Everything here is STEERING, never evidence. Meeting notes are somebody's
 * recollection and custom instructions are a request, so neither can become a
 * finding on its own: the screenshots remain the only proof of what the site
 * does. That boundary is spelled out in the prompt below because the failure it
 * prevents (writing "as discussed, your reviews are strong" about a page with no
 * reviews on it) reads as authoritative and is very hard to spot later.
 *
 * Fireflies transcripts get pasted in whole, so notes are capped hard: the tail
 * of a call is rarely the brief, and a 40k-token transcript in every one of the
 * seven steps is real money. */
const CONTEXT_NOTES_CAP = 4_000;
const CONTEXT_FIELD_CAP = 2_000;

async function loadAuditContextBlock(
  sb: ReturnType<typeof assertServiceClient>,
  auditId: string,
  clientId: string,
): Promise<string> {
  try {
    const [{ data: audit }, { data: client }] = await Promise.all([
      sb.from("audits").select("context").eq("id", auditId).maybeSingle(),
      sb.from("clients").select("name, company_name, industry, website_url").eq("id", clientId).maybeSingle(),
    ]);
    const ctx = (audit?.context ?? {}) as {
      meeting_notes?: unknown;
      client_background?: unknown;
      custom_instructions?: unknown;
      sells_subscriptions?: unknown;
    };
    const str = (v: unknown, cap: number) => (typeof v === "string" ? v.trim().slice(0, cap) : "");
    const background = str(ctx.client_background, CONTEXT_FIELD_CAP);
    const instructions = str(ctx.custom_instructions, CONTEXT_FIELD_CAP);
    const notes = str(ctx.meeting_notes, CONTEXT_NOTES_CAP);

    const facts: string[] = [];
    const who = String(client?.company_name ?? client?.name ?? "").trim();
    if (who) facts.push(`Store: ${who}`);
    const industry = String(client?.industry ?? "").trim();
    if (industry) facts.push(`Industry: ${industry}`);
    if (ctx.sells_subscriptions === true) facts.push(`Sells subscriptions.`);

    if (facts.length === 0 && !background && !instructions && !notes) return "";

    const parts: string[] = [
      `\n\nABOUT THIS CLIENT. Use it to decide what matters most on this store and to write in terms the client recognises.`,
    ];
    if (facts.length) parts.push(facts.join("\n"));
    if (background) parts.push(`BACKGROUND:\n${background}`);
    if (notes) parts.push(`NOTES FROM THE CALL (someone's recollection, not evidence about the site):\n${notes}`);
    if (instructions) {
      parts.push(
        `WHAT THE STRATEGIST ASKED YOU TO FOCUS ON (highest priority, follow it):\n${instructions}`,
      );
    }
    parts.push(
      `HOW TO USE THIS: it changes which findings you lead with and how you phrase them. It is NOT evidence about the site. Every finding must still be something you can SEE in the screenshots, so never report an issue because the notes mention it, never claim something is on the page because the client said so, and if the notes and the screenshots disagree, the screenshots win. The brief itself is invisible to the reader: the CLIENT reads this report, so never refer to "the call", "the brief", "as discussed", or to "the client" in the third person ("the path the client cares most about"). Address them as "you" and let the prioritisation show the focus rather than announcing it.`,
    );
    return parts.join("\n\n");
  } catch {
    // Context is an enhancement; an audit must never fail for want of it.
    return "";
  }
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

  // CAPTURE MUST BE FINISHED FIRST. Analysis reads only screenshots whose row
  // says "success", so a page whose shot has not landed yet looks exactly like a
  // page that does not exist, and runStep used to HIDE it permanently. That is
  // how audit 633eec94 shipped with no homepage and no product section: analysis
  // started at 12:36:47 while the capture chain was still working, and those two
  // shots did not land until 12:38 and 12:40.
  //
  // Deferring is safe and self-healing: the capture chain kicks this function
  // again the moment its last shot lands (remaining === 0), and the job row is
  // left untouched at the step it was on, so nothing is lost and no step is
  // skipped. Whatever started us early simply waits.
  const { count: stillCapturing } = await sb
    .from("web_page_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("audit_id", auditId)
    .eq("status", "pending");
  if ((stillCapturing ?? 0) > 0) {
    await sb.from("audit_analysis_jobs").update({
      status: "pending",
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({
      ok: true,
      correlationId,
      status: "waiting_for_capture",
      pending_screenshots: stillCapturing ?? 0,
    });
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
    const contextBlock = await loadAuditContextBlock(sb, auditId, audit.client_id as string);
    await runStep(sb, llm, auditId, step, (freshRows ?? []) as SectionRow[], undefined, contextBlock);
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
    // Any section, not just a page: the performance, overview and roadmap
    // sections are just as worth re-running on their own, and restricting this
    // to pages meant the only way to refresh one of them was regenerating the
    // whole audit and overwriting every other section with it.
    const step = STEPS.find((s) => s.key === sectionKey);
    if (!step) return json({ ok: false, error: { code: "bad_request", message: "Unknown section_key" }, correlationId }, { status: 400 });
    try {
      const sb = assertServiceClient();
      const { data: rows } = await sb
        .from("audit_sections")
        .select("id, section_key, summary_text, section_details, section_config")
        .eq("audit_id", auditId);
      const sectionsList = (rows ?? []) as SectionRow[];
      const llm = createLlmClient("anthropic", { model: WEB_MODEL });
      // Regenerating one section reads the same client context as a full run, so
      // a re-run never silently drops the brief the first pass was written with.
      const { data: auditRow } = await sb.from("audits").select("client_id").eq("id", auditId).maybeSingle();
      const contextBlock = auditRow?.client_id
        ? await loadAuditContextBlock(sb, auditId, auditRow.client_id as string)
        : "";
      await runStep(sb, llm, auditId, step, sectionsList, b.instruction?.trim() || undefined, contextBlock);
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
