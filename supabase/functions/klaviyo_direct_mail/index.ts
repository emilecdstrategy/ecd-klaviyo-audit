// Adds the direct mail (PostPilot) section to a Klaviyo audit, when it earns it.
//
// Runs after the analysis pipeline has persisted, and on demand for a backfill.
// Reads the audit's own counts (profile scan, Placed Order metric, flows), the
// client's market and, when Shopify is connected, its traffic; sizes the
// audience email cannot reach; and applies a strict gate. A qualifying audit
// gets a "direct_mail" section with a model-written narrative around
// code-computed numbers, plus the PostPilot add-on highlighted in its layout so
// the proposal picks it up. An audit that does not qualify gets the same row
// with the verdict and reasons, hidden, so the strategist can see why.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hasCronSecret, isServiceRoleAuthorization, requireStaffUserId } from "../_shared/auth.ts";
import { decryptString } from "../_shared/crypto.ts";
import { createLlmClient, type LlmTool } from "../_shared/llm-adapter.ts";
import { sanitizeDashDeep } from "../_shared/dash.ts";
import { KLAVIYO_BASE, KLAVIYO_REVISION } from "../_shared/klaviyo-api.ts";
import { exchangeClientCredentials, normalizeShopDomain, shopifyRest } from "../_shared/shopify-api.ts";
import { fetchSessions } from "../_shared/shopify-sessions.ts";
import {
  buildDirectMailPlan,
  type CoreFlowState,
  DIRECT_MAIL_SECTION_KEY,
  DIRECT_MAIL_TEMPLATE_SLUG,
  type DirectMailInputs,
  type DirectMailPlan,
  factsForNarrative,
  inferMarketFromKlaviyoAccount,
  type MarketSource,
} from "../_shared/direct-mail.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MODEL = "claude-sonnet-5";
const AOV_WINDOW_DAYS = 90;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Sb = SupabaseClient;

// --- Inputs ------------------------------------------------------------------

/** Average order value from the conversion metric, over a fixed window. Asks
 * Klaviyo for count and sum together so the two cannot disagree. */
async function readAov(
  apiKey: string,
  revision: string,
  metricId: string,
  timezone: string,
): Promise<{ aov: number | null; orders: number | null }> {
  const since = new Date(Date.now() - AOV_WINDOW_DAYS * 86_400_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const res = await fetch(`${KLAVIYO_BASE}/api/metric-aggregates/`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Klaviyo-API-Key ${apiKey}`,
        revision,
      },
      body: JSON.stringify({
        data: {
          type: "metric-aggregate",
          attributes: {
            metric_id: metricId,
            measurements: ["count", "sum_value"],
            interval: "month",
            filter: [
              `greater-or-equal(datetime,${since.toISOString()})`,
              `less-than(datetime,${new Date().toISOString()})`,
            ],
            timezone: timezone || "UTC",
          },
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { aov: null, orders: null };
    const body = await res.json().catch(() => null);
    const points = body?.data?.attributes?.data ?? [];
    let count = 0;
    let sum = 0;
    const add = (v: unknown, into: (n: number) => void) => {
      if (Array.isArray(v)) for (const x of v) into(Number(x) || 0);
      else if (v != null) into(Number(v) || 0);
    };
    for (const p of points) {
      add(p?.measurements?.count, (n) => { count += n; });
      add(p?.measurements?.sum_value, (n) => { sum += n; });
    }
    if (count <= 0 || sum <= 0) return { aov: null, orders: count > 0 ? count : null };
    return { aov: sum / count, orders: count };
  } catch {
    return { aov: null, orders: null };
  } finally {
    clearTimeout(t);
  }
}

async function shopifyAccess(sb: Sb, clientId: string) {
  const [{ data: conn }, { data: sec }] = await Promise.all([
    sb.from("shopify_connections").select("shop_domain, auth_method, app_client_id").eq("client_id", clientId).maybeSingle(),
    sb.from("client_secrets").select("shopify_admin_token_ciphertext, shopify_admin_token_iv").eq("client_id", clientId).maybeSingle(),
  ]);
  const shopDomain = normalizeShopDomain(conn?.shop_domain ?? "");
  if (!shopDomain || !sec?.shopify_admin_token_ciphertext || !sec?.shopify_admin_token_iv) return null;
  try {
    const stored = await decryptString(sec.shopify_admin_token_ciphertext, sec.shopify_admin_token_iv);
    if (conn?.auth_method === "client_credentials") {
      const grant = await exchangeClientCredentials(shopDomain, conn.app_client_id ?? "", stored);
      if (!grant.ok) return null;
      return { shopDomain, token: grant.token };
    }
    return { shopDomain, token: stored };
  } catch {
    return null;
  }
}

async function collectInputs(sb: Sb, auditId: string, clientId: string, context: Record<string, unknown> | null) {
  const [rollupRes, kconnRes, secRes, flowsRes, segRes, tplRes] = await Promise.all([
    sb.from("klaviyo_reporting_rollups").select("computed").eq("audit_id", auditId).eq("timeframe_key", "last_30_days").maybeSingle(),
    sb.from("klaviyo_connections").select("conversion_metric_id, timezone, preferred_currency, revision").eq("client_id", clientId).maybeSingle(),
    sb.from("client_secrets").select("klaviyo_private_key_ciphertext, klaviyo_private_key_iv").eq("client_id", clientId).maybeSingle(),
    sb.from("audit_sections").select("section_details").eq("audit_id", auditId).eq("section_key", "flows").maybeSingle(),
    sb.from("audit_sections").select("section_details").eq("audit_id", auditId).eq("section_key", "segmentation").maybeSingle(),
    sb.from("revenue_opportunity_templates").select("*").eq("slug", DIRECT_MAIL_TEMPLATE_SLUG).maybeSingle(),
  ]);

  const snap = ((rollupRes.data?.computed as Record<string, unknown> | null)?.account_snapshot ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // AOV from the verified conversion metric. Without a key or a metric there is
  // no AOV, and the gate says so rather than guessing.
  let aov: { aov: number | null; orders: number | null } = { aov: null, orders: null };
  const metricId = String(kconnRes.data?.conversion_metric_id ?? "").trim();
  if (metricId && secRes.data?.klaviyo_private_key_ciphertext && secRes.data?.klaviyo_private_key_iv) {
    try {
      const apiKey = await decryptString(secRes.data.klaviyo_private_key_ciphertext, secRes.data.klaviyo_private_key_iv);
      aov = await readAov(apiKey, String(kconnRes.data?.revision ?? KLAVIYO_REVISION), metricId, String(kconnRes.data?.timezone ?? "UTC"));
    } catch { /* recorded as unknown */ }
  }

  // Market and traffic. Shopify is the authority when connected; otherwise the
  // Klaviyo account's currency and timezone decide US or unknown. Only one of
  // nineteen Klaviyo clients has a store connected, so Shopify-only would have
  // switched this off for nearly everyone.
  let market: { country: string | null; source: MarketSource } = { country: null, source: "unknown" };
  let sessions: number | null = null;
  const shop = await shopifyAccess(sb, clientId);
  if (shop) {
    try {
      const res = await shopifyRest(shop.shopDomain, shop.token, "/shop.json?fields=country_code");
      const cc = String(res.body?.shop?.country_code ?? "").trim();
      if (res.ok && cc) market = { country: cc.toUpperCase(), source: "shopify" };
    } catch { /* fall through */ }
    try {
      const report = await fetchSessions(shop.shopDomain, shop.token, 30);
      if (report && !report.error && report.current.sessions > 0) sessions = report.current.sessions;
    } catch { /* traffic stays unknown */ }
  }
  if (!market.country) {
    const inferred = inferMarketFromKlaviyoAccount(kconnRes.data?.preferred_currency, kconnRes.data?.timezone);
    if (inferred) market = { country: inferred, source: "klaviyo_account" };
  }

  const coreFlows = (((flowsRes.data?.section_details as Record<string, unknown> | null)?.flows as { core_flows?: unknown[] } | undefined)?.core_flows ?? [])
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.flow_name === "string")
    .map<CoreFlowState>((f) => ({ flow_name: String(f.flow_name), present: f.present === true, live: f.live === true }));
  const segDetails = ((segRes.data?.section_details as Record<string, unknown> | null)?.segmentation ?? null) as { has_vip_segments?: boolean } | null;

  const tpl = tplRes.data as Record<string, unknown> | null;
  const inputs: DirectMailInputs = {
    total_profiles: n(snap.total_profiles_count),
    email_subscribed: n(snap.email_subscribed_profiles_count),
    active_90d: n(snap.active_profiles_90d_count),
    suppressed: n(snap.suppressed_profiles_count),
    counts_partial: snap.profile_scan_status === "partial" || snap.suppressed_profiles_truncated === true,
    aov: aov.aov,
    aov_orders: aov.orders,
    aov_window_days: AOV_WINDOW_DAYS,
    market,
    monthly_sessions: sessions,
    core_flows: coreFlows,
    has_vip_segments: typeof segDetails?.has_vip_segments === "boolean" ? segDetails.has_vip_segments : null,
    sells_subscriptions: Boolean(context?.sells_subscriptions),
    fees: {
      setup: n(tpl?.one_time_price == null ? null : Number(tpl.one_time_price)),
      monthly: n(tpl?.monthly_price == null ? null : Number(tpl.monthly_price)),
    },
  };
  return { inputs, template: tpl, profileScanStatus: String(snap.profile_scan_status ?? "") };
}

// --- Narrative ---------------------------------------------------------------

type Narrative = {
  current_state_title: string;
  optimized_state_title: string;
  current_state_notes: string;
  optimized_notes: string;
  ai_findings: string;
  summary_text: string;
  key_findings: string[];
};

const NARRATIVE_TOOL: LlmTool = {
  name: "record_direct_mail_section",
  description: "Write the narrative of the direct mail section of a Klaviyo audit from the facts supplied.",
  input_schema: {
    type: "object",
    required: ["current_state_title", "optimized_state_title", "current_state_notes", "optimized_notes", "ai_findings", "summary_text", "key_findings"],
    properties: {
      current_state_title: { type: "string", description: "Short heading for what the email program cannot reach today. 3 to 8 words." },
      optimized_state_title: { type: "string", description: "Short heading for the direct mail companion. 3 to 8 words." },
      current_state_notes: { type: "string", description: "One or two short paragraphs. The gap in this account, in the client's own numbers." },
      optimized_notes: { type: "string", description: "One or two short paragraphs. What the program looks like: pairings at the end of existing flows, the unreachable winback, holdouts." },
      ai_findings: { type: "string", description: "Two or three short paragraphs for the strategist: the case, the integration path, the measurement plan." },
      summary_text: { type: "string", description: "Two sentences a client reads first." },
      key_findings: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: { type: "string" },
        description: "Each one a specific point about THIS account, with a number from the facts where one exists.",
      },
    },
  },
};

const SYSTEM = `You write one section of a Klaviyo lifecycle audit for ECD Digital Strategy: the direct mail companion, built on PostPilot.

Hard rules, none of them optional:
- Use only the facts you are given. Every number in your text must appear in the facts. If a fact is missing, do not fill it in.
- Direct mail is a companion to Klaviyo, never a replacement, and it does not fix deliverability or list health. Never suggest otherwise.
- Quote benchmarks as medians with their spread, exactly as given. Never quote a case-study result, and never present a benchmark as a forecast for this brand.
- Say "iROAS" only for holdout-measured figures; never convert it to revenue for this brand.
- Event Sync is beta and opt-in. MailMatch resolves 60 to 70% of emails. Size every audience off the matched count.
- Where the facts list an assumption that affects a number you use, say it in one clause.
- Write for the client, not for the analyst. Never tell the reader how tables "should be sized" or restate methodology as instructions; state the number and, if needed, the one-clause assumption behind it. Do not mention our tooling or connections (say "site traffic was not sized in this audit", never "without a Shopify connection").
- Plain business English, second person to the client, no hype, no filler. Never use an em dash or en dash; use commas or full stops.
- The core framing: the Klaviyo program is doing its job; this section is about the profiles it will never be allowed to touch.`;

// Why the last narrative attempt gave up, surfaced in the response because the
// hosted log query is not reliable enough to lean on for a diagnosis.
let lastNarrativeError: string | null = null;

async function writeNarrative(plan: DirectMailPlan, companyName: string): Promise<Narrative | null> {
  lastNarrativeError = null;
  try {
    const llm = createLlmClient("anthropic", { model: MODEL });
    const turn = await llm.runTurn({
      system: SYSTEM,
      messages: [{
        role: "user",
        text: `FACTS FOR ${companyName}:\n${factsForNarrative(plan, companyName)}\n\nCall record_direct_mail_section exactly once.`,
      }],
      tools: [NARRATIVE_TOOL],
      toolChoice: { type: "tool", name: "record_direct_mail_section" },
    });
    if (turn.kind !== "tool_call") {
      lastNarrativeError = "model did not call the tool: " + JSON.stringify(turn).slice(0, 400);
      console.error("direct_mail narrative:", lastNarrativeError);
      return null;
    }
    const input = (turn.input ?? {}) as Partial<Narrative>;
    const items = Array.isArray(input.key_findings) ? input.key_findings.map((s) => String(s).trim()).filter(Boolean) : [];
    if (items.length < 3) {
      lastNarrativeError = "fewer than 3 key findings: " + items.length;
      console.error("direct_mail narrative:", lastNarrativeError);
      return null;
    }
    return sanitizeDashDeep({
      current_state_title: String(input.current_state_title ?? "").trim() || "What email cannot reach",
      optimized_state_title: String(input.optimized_state_title ?? "").trim() || "Direct mail as the last step of every flow",
      current_state_notes: String(input.current_state_notes ?? "").trim(),
      optimized_notes: String(input.optimized_notes ?? "").trim(),
      ai_findings: String(input.ai_findings ?? "").trim(),
      summary_text: String(input.summary_text ?? "").trim(),
      key_findings: items.slice(0, 5),
    });
  } catch (e) {
    lastNarrativeError = e instanceof Error ? e.message : String(e);
    console.error("direct_mail narrative failed:", lastNarrativeError);
    return null;
  }
}

/** Plain numbers in plain sentences, for when the model is unavailable. The
 * section still ships; it just reads like a table. */
function fallbackNarrative(plan: DirectMailPlan): Narrative {
  const g = plan.gap!;
  const rec = plan.investment?.find((c) => c.label === "Recommended");
  const fmt = (v: number) => v.toLocaleString("en-US");
  return sanitizeDashDeep({
    current_state_title: "What email cannot reach",
    optimized_state_title: "Direct mail as the last step of every flow",
    current_state_notes:
      `Of ${fmt(g.total_profiles)} profiles, ${fmt(g.suppressed)} (${g.suppressed_pct}%) are suppressed or unsubscribed and ${fmt(g.unengaged)} (${g.unengaged_pct}%) have not engaged in 90 days. Email is not allowed to reach the first group and should not be sent to the second. After address matching that is roughly ${fmt(g.mailable.low)} to ${fmt(g.mailable.high)} people a postcard can still reach.`,
    optimized_notes:
      `Each existing flow gets a postcard at the end of its email sequence, and the suppressed and unengaged audience gets a winback program email cannot run. Every campaign holds out a share of its audience so results are read as incremental ROAS.` +
      (rec ? ` The recommended program is about ${fmt(rec.pieces_per_month)} pieces a month, roughly $${fmt(rec.postpilot_monthly_total)} a month to PostPilot.` : ""),
    ai_findings:
      `Retention programs to 1+ order customers have a holdout-tested median of ${plan.cannot_run[0].benchmark.median}x iROAS (${plan.cannot_run[0].benchmark.p25}x to ${plan.cannot_run[0].benchmark.p75}x). Connect Klaviyo to PostPilot over OAuth and sync the segments; a Shopify connection is a prerequisite. Test two or three one-offs with holdouts, read at 30 days, then automate the winners.`,
    summary_text:
      `Your Klaviyo program is doing its job. This section is about the ${fmt(g.unreachable)} profiles it is not allowed to touch, and how a postcard reaches them.`,
    key_findings: [
      `${fmt(g.suppressed)} suppressed or unsubscribed profiles (${g.suppressed_pct}%) are permanently unreachable by email and still former or potential customers.`,
      `${fmt(g.unengaged)} subscribers (${g.unengaged_pct}%) have not opened or clicked in 90 days, and good deliverability hygiene keeps them out of sends.`,
      `After a 60 to 70% address match, about ${fmt(g.mailable.low)} to ${fmt(g.mailable.high)} people can be reached by post; none of that revenue is in the email forecast.`,
      ...(rec && rec.break_even_rate != null
        ? [`At a blended $${rec.blended_cpp.toFixed(2)} per piece, ${(rec.break_even_rate * 100).toFixed(2)}% of recipients need to order for a card to pay for itself.`]
        : []),
    ],
  });
}

// --- Persist -----------------------------------------------------------------

async function upsertSection(sb: Sb, auditId: string, plan: DirectMailPlan, narrative: Narrative | null) {
  const { data: rows } = await sb.from("audit_sections").select("id, section_key, status, section_config").eq("audit_id", auditId);
  const existing = (rows ?? []).find((r) => r.section_key === DIRECT_MAIL_SECTION_KEY);
  // The public report shows approved sections when any exist, so this row has
  // to match its siblings or it vanishes from the client's view.
  const siblingStatus = (rows ?? []).find((r) => r.section_key === "flows")?.status ?? "approved";

  const existingConfig = ((existing?.section_config as Record<string, unknown> | null) ?? {});
  const dmConfig = { ...((existingConfig[DIRECT_MAIL_SECTION_KEY] as Record<string, unknown> | undefined) ?? {}) };
  // Not qualified: hide it. Qualified: unhide only if we were the ones who hid
  // it, so a strategist's own choice to hide the section survives a re-run.
  if (!plan.gate.qualified) {
    dmConfig.hidden = true;
    dmConfig.hidden_by_gate = true;
  } else if (dmConfig.hidden_by_gate === true) {
    delete dmConfig.hidden;
    delete dmConfig.hidden_by_gate;
  }
  const sectionConfig = { ...existingConfig, [DIRECT_MAIL_SECTION_KEY]: dmConfig };

  const n = narrative;
  const patch: Record<string, unknown> = {
    section_key: DIRECT_MAIL_SECTION_KEY,
    audit_id: auditId,
    status: siblingStatus,
    revenue_opportunity: 0,
    confidence: plan.gate.qualified ? (plan.gap?.counts_partial ? "medium" : "high") : "low",
    section_details: { [DIRECT_MAIL_SECTION_KEY]: plan },
    section_config: sectionConfig,
  };
  if (n) {
    Object.assign(patch, {
      current_state_title: n.current_state_title,
      optimized_state_title: n.optimized_state_title,
      current_state_notes: n.current_state_notes,
      optimized_notes: n.optimized_notes,
      ai_findings: n.ai_findings,
      summary_text: n.summary_text,
      key_findings: { items: n.key_findings, items_hidden: n.key_findings.map(() => false) },
    });
  } else if (!existing) {
    Object.assign(patch, {
      current_state_title: "", optimized_state_title: "", current_state_notes: "", optimized_notes: "",
      ai_findings: "", human_edited_findings: "", summary_text: "", key_findings: { items: [], items_hidden: [] },
    });
  }

  if (existing) {
    const { audit_id: _a, section_key: _k, ...rest } = patch;
    const { error } = await sb.from("audit_sections").update(rest).eq("id", existing.id);
    if (error) throw error;
    return existing.id as string;
  }
  const { data, error } = await sb.from("audit_sections").insert(patch).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Put the PostPilot add-on on the audit, highlighted, or take our own copy
 * off again if the audit no longer qualifies. An item the strategist added by
 * hand (no auto_added flag) is never touched. */
async function syncAddOn(sb: Sb, auditId: string, layout: Record<string, unknown>, template: Record<string, unknown> | null, plan: DirectMailPlan) {
  if (!template) return { changed: false, reason: "no_template" };
  const revenueSummary = { ...((layout.revenue_summary as Record<string, unknown> | undefined) ?? {}) };
  const blocks = { ...((revenueSummary.blocks as Record<string, unknown> | undefined) ?? {}) };
  const addOns = { ...((blocks.addOns as Record<string, unknown> | undefined) ?? {}) };
  const items = Array.isArray(addOns.items) ? [...(addOns.items as Array<Record<string, unknown>>)] : [];
  const idx = items.findIndex((it) => String(it?.template_slug ?? "") === DIRECT_MAIL_TEMPLATE_SLUG);

  const presenterNote = plan.gap
    ? `Show the ${plan.gap.suppressed.toLocaleString("en-US")} suppressed and ${plan.gap.unengaged.toLocaleString("en-US")} unengaged profiles, then the flow pairings table: the postcard goes at the end of each flow they already run.`
    : "Show the reachability gap and the flow pairings table.";

  if (plan.gate.qualified) {
    if (idx >= 0) {
      items[idx] = { ...items[idx], highlighted: true, related_section_keys: ["flows", "segmentation"], presenter_note: presenterNote, is_hidden: false };
    } else {
      const maxOrder = items.reduce((m, it) => Math.max(m, Number(it?.display_order ?? 0)), 0);
      items.push({
        template_slug: DIRECT_MAIL_TEMPLATE_SLUG,
        name: String(template.name ?? "Direct Mail via PostPilot"),
        description: template.description ? String(template.description) : undefined,
        content: template.content ? String(template.content) : undefined,
        bullets: [],
        revenue_monthly: 0,
        one_time_price: template.one_time_price == null ? null : Number(template.one_time_price),
        one_time_label: template.one_time_label ? String(template.one_time_label) : null,
        monthly_price: template.monthly_price == null ? null : Number(template.monthly_price),
        monthly_label: template.monthly_label ? String(template.monthly_label) : null,
        image_url: template.image_url ? String(template.image_url) : null,
        details_url: template.details_url ? String(template.details_url) : null,
        display_order: maxOrder + 10,
        is_hidden: false,
        highlighted: true,
        related_section_keys: ["flows", "segmentation"],
        presenter_note: presenterNote,
        investment_included: true,
        auto_added: true,
      });
    }
  } else {
    if (idx < 0) return { changed: false, reason: "not_qualified" };
    if (items[idx].auto_added !== true) return { changed: false, reason: "manual_item_kept" };
    items.splice(idx, 1);
  }

  addOns.items = items;
  blocks.addOns = addOns;
  revenueSummary.blocks = blocks;
  const nextLayout = { ...layout, revenue_summary: revenueSummary };
  const { error } = await sb.from("audits").update({ layout: nextLayout, updated_at: new Date().toISOString() }).eq("id", auditId);
  if (error) throw error;
  return { changed: true, reason: plan.gate.qualified ? "added_or_refreshed" : "removed" };
}

// --- Entry -------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });
  const correlationId = crypto.randomUUID();

  try {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!isServiceRoleAuthorization(bearer) && !(await hasCronSecret(req, "web_pipeline_cron_secret"))) {
      try {
        await requireStaffUserId(req, "audits");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return json({ ok: false, error: { code: "unauthorized", message }, correlationId }, { status: message === "Forbidden" ? 403 : 401 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as { audit_id?: string; skip_narrative?: boolean };
    const auditId = String(body.audit_id ?? "").trim();
    if (!auditId) return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });

    const sb = serviceClient();
    const { data: audit, error: auditErr } = await sb
      .from("audits")
      .select("id, client_id, audit_type, audit_method, layout, context")
      .eq("id", auditId)
      .maybeSingle();
    if (auditErr) throw auditErr;
    if (!audit) return json({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    if ((audit.audit_type ?? "klaviyo") !== "klaviyo" || audit.audit_method !== "api") {
      return json({ ok: true, correlationId, status: "skipped", reason: "not_klaviyo_api_audit" });
    }

    const { data: client } = await sb.from("clients").select("company_name, name").eq("id", audit.client_id).maybeSingle();
    const companyName = String(client?.company_name || client?.name || "the brand");
    const context = (audit.context && typeof audit.context === "object") ? audit.context as Record<string, unknown> : null;

    const { inputs, template, profileScanStatus } = await collectInputs(sb, auditId, audit.client_id as string, context);
    // The counts come from the profile scan. Until it has finished there is
    // nothing honest to size, so the run waits for the next trigger.
    if (inputs.total_profiles == null || (profileScanStatus !== "complete" && profileScanStatus !== "partial")) {
      return json({ ok: true, correlationId, status: "skipped", reason: "profile_scan_not_ready", profile_scan_status: profileScanStatus || null });
    }

    const plan = buildDirectMailPlan(inputs);
    let narrative: Narrative | null = null;
    let narrativeSource = "none";
    if (plan.gate.qualified) {
      narrative = body.skip_narrative ? null : await writeNarrative(plan, companyName);
      narrativeSource = narrative ? "model" : "fallback";
      if (!narrative) narrative = fallbackNarrative(plan);
    }

    const sectionId = await upsertSection(sb, auditId, plan, narrative);
    const addOn = await syncAddOn(sb, auditId, (audit.layout as Record<string, unknown> | null) ?? {}, template, plan);

    return json({
      ok: true,
      correlationId,
      status: "complete",
      qualified: plan.gate.qualified,
      reasons: plan.gate.reasons,
      checks: plan.gate.checks,
      market: plan.market,
      gap: plan.gap ? { mailable_mid: plan.gap.mailable.mid, suppressed: plan.gap.suppressed, unengaged: plan.gap.unengaged, sitematch: plan.gap.sitematch } : null,
      aov: plan.aov,
      section_id: sectionId,
      add_on: addOn,
      narrative: narrativeSource,
      narrative_error: lastNarrativeError,
    });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : String(e) }, correlationId }, { status: 200 });
  }
});
