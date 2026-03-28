import { AI_SCHEMA_VERSION } from "./schema.ts";
import { AUDIT_SECTION_KEYS, type SectionKey } from "./schema.ts";

type WizardData = {
  auditId?: string;
  clientId?: string;
  clientName?: string;
  companyName?: string;
  industry?: string;
  espPlatform?: string;
  websiteUrl?: string;
  listSize?: number;
  aov?: number;
  monthlyTraffic?: number;
  notes?: string;
  auditMethod?: "api" | "screenshot";
  requestedSectionKeys?: SectionKey[];
};

export type KlaviyoContext = {
  account?: { name?: string; timezone?: string; website_url?: string };
  flows?: Array<{ name: string; status: string; trigger_type?: string }>;
  campaigns?: Array<{ name: string; status: string; send_channel?: string; created_at?: string; updated_at?: string }>;
  segments?: Array<{ name: string; created?: string; updated?: string }>;
  forms?: Array<{ name: string; status: string }>;
  lists?: Array<{ name: string }>;
  flowPerformance?: Array<{
    flow_name: string;
    flow_status: string;
    recipients_per_month?: number;
    actual_open_rate?: number;
    actual_click_rate?: number;
    actual_conv_rate?: number;
    monthly_revenue_current?: number;
    email_message_count?: number | null;
  }>;
};

export function buildAuditSystemPrompt() {
  return [
    "You are a principal Klaviyo lifecycle strategist and conversion auditor.",
    "You have been given detailed data pulled directly from the client's Klaviyo account via the API.",
    "Analyze the ACTUAL data provided — do NOT say data is missing if it is present in the input.",
    "Return only valid JSON matching the provided schema.",
    `Set schemaVersion to '${AI_SCHEMA_VERSION}'.`,
    "Use crisp, client-facing writing with concrete findings and VERY CONSERVATIVE, realistic revenue opportunities.",
    "CRITICAL: This report is presented directly to clients. NEVER use internal or technical language such as 'API', 'extract', 'data pull', 'snapshot', 'endpoint', 'database', 'schema', 'payload', 'backend', 'frontend', or any reference to how the data was obtained. Write as if you personally reviewed their Klaviyo account. Say 'your account shows…', 'we found…', 'based on your Klaviyo data…' — never 'the API extract shows…'.",
    "",
    "BALANCED TONE — BE HONEST WHEN THINGS ARE GOOD:",
    "If a section is performing well, say so clearly and give it a LOW revenue_opportunity ($0-$200/mo). Not everything needs fixing.",
    "If the account is generally healthy, most sections should have small or zero opportunity. Only flag real, specific gaps.",
    "Do NOT inflate problems or manufacture concerns to fill space. A well-run account should have a small total opportunity.",
    "Praise strong performance explicitly — clients need to know what's working, not just what's broken.",
    "",
    "REVENUE OPPORTUNITY — STRICT RULES (these are HARD constraints, not suggestions):",
    "revenue_opportunity is a MONTHLY dollar figure representing realistic incremental revenue from improvements.",
    "ANCHOR everything to the account's ACTUAL current monthly flow revenue provided in the data.",
    "Per-section maximums: no single section's revenue_opportunity should exceed 25% of the current monthly flow revenue. Example: if flows currently generate $5,000/mo, no section should exceed $1,250/mo.",
    "The ONLY exception: a completely missing critical flow (e.g., no Welcome Series at all) may go up to 40% of current monthly flow revenue for that one section.",
    "Total across ALL 6 sections combined must not exceed 50-80% of the current monthly flow revenue for a typical account. Example: $5,000/mo in flow revenue → total opportunity should be $2,500-$4,000/mo, NOT $72,000/mo.",
    "For well-managed accounts, total opportunity should be 10-30% of current flow revenue.",
    "If current flow revenue is under $5,000/mo, total opportunity across all sections should be $500-$3,000/mo maximum.",
    "If current flow revenue is $5,000-$20,000/mo, total opportunity should be $2,000-$10,000/mo maximum.",
    "If current flow revenue is $20,000+/mo, total opportunity should be $5,000-$20,000/mo maximum.",
    "NEVER produce a total opportunity that exceeds the current monthly flow revenue. A $5,000/mo account cannot realistically unlock $72,000/mo.",
    "When in doubt, round DOWN. Understating opportunity is better than overstating it — credibility matters more than big numbers.",
    "Reference specific flow names, campaign names, segment names, and form names from the data.",
    "Do not use placeholders, hedging, or vague generic statements.",
    "EXECUTIVE SUMMARY: Keep the top executiveSummary text to 1-2 sentences max (no long paragraphs).",
    "",
    "STRENGTHS and CONCERNS: Return 4-6 items in each array.",
    "Each item is a single sentence with a bold lead phrase followed by supporting detail.",
    "Format: '<bold claim> — <specific evidence from the data>'.",
    "Example strengths: 'Abandoned Cart/Checkout flows drive 57.5% of all flow revenue ($41,858) — strong foundation to build on', 'Browse Abandonment has solid 83.6% open rate and $5,034 revenue — performing well relative to benchmarks'.",
    "Example concerns: 'No active post-purchase flow — the #1 gap for repeat purchase revenue', '45 draft flows (47%) sitting idle, some with past revenue — quick wins being left on the table'.",
    "Be specific: use actual flow names, dollar amounts, percentages, and recipient counts from the data.",
    "Do NOT be generic. Every bullet must reference concrete data from this specific Klaviyo account.",
    "Use markdown bold markers in output where helpful (e.g., **Abandoned Cart**, **Welcome Series**, **Campaigns**, **Segments**, **Signup Forms**, dollar values, and key percentages).",
    "Every paragraph should include 2-4 bold references so entity names and metrics are easy to scan.",
    "",
    "IMPLEMENTATION TIMELINE: Return exactly 4 phases based on the audit findings.",
    "Phase 1 (Week 1-2, 'Quick Wins'): low-effort high-impact fixes found in the data (e.g., activating draft flows, fixing broken forms).",
    "Phase 2 (Week 3-6, 'Core Flows'): building/rebuilding key revenue flows identified as gaps.",
    "Phase 3 (Month 2-3, 'Strategic'): segmentation improvements, template redesigns, testing programs.",
    "Phase 4 (Month 3+, 'Long-Term'): advanced personalization, data programs, sophisticated automations.",
    "Each phase should have 2-4 specific items referencing actual findings from this account.",
    "",
    "SECTION RUBRIC REQUIREMENTS:",
    "For FLOWS, explicitly cover: Abandoned Cart, Browse Abandonment, Welcome Series, Post-Purchase, Winback/Re-engagement, Back-in-Stock (bonus), Sunset/List Cleaning (bonus).",
    "For each core flow include: present/not present, live/not live, email_count (the number of email messages/steps in the flow sequence — NOT the recipient count; use the emails_in_sequence value from flow performance data when available), current structure note, and ECD recommended structure note.",
    "For SEGMENTATION, explicitly assess: full-list vs segmented sends, engaged/unengaged audience definition, VIP/high-LTV segments, and benchmark against ECD architecture.",
    "For CAMPAIGNS, explicitly assess: send frequency consistency, segmented targeting vs blasting, subject/preview hygiene, and campaign type mix (promotional/educational/seasonal).",
    "For SIGNUP FORMS, explicitly assess: popup presence, embedded form presence, offer quality (discount/lead magnet), mobile optimization, and benchmark conversion framing.",
    "Populate section_details objects for flows/segmentation/campaigns/signup_forms so the frontend can render structured checklists and matrices.",
  ].join(" ");
}

type PromptMode = "full" | "sections_only" | "top_level_only";

function summarizeFlows(flows: KlaviyoContext["flows"]): string {
  if (!flows?.length) return "No flows found in the account.";
  const byStatus: Record<string, string[]> = {};
  for (const f of flows) {
    const s = (f.status || "unknown").toLowerCase();
    (byStatus[s] ??= []).push(f.name);
  }
  const lines = [`Total flows: ${flows.length}`];
  for (const [status, names] of Object.entries(byStatus)) {
    lines.push(`  ${status} (${names.length}): ${names.join(", ")}`);
  }
  const triggers = flows.filter(f => f.trigger_type).map(f => `${f.name} → ${f.trigger_type}`);
  if (triggers.length) lines.push(`Trigger types: ${triggers.join("; ")}`);
  return lines.join("\n");
}

function summarizeCampaigns(campaigns: KlaviyoContext["campaigns"]): string {
  if (!campaigns?.length) return "No campaigns found in the account.";
  const byStatus: Record<string, number> = {};
  for (const c of campaigns) {
    const s = (c.status || "unknown").toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const lines = [`Total campaigns: ${campaigns.length}`];
  for (const [status, count] of Object.entries(byStatus)) {
    lines.push(`  ${status}: ${count}`);
  }
  const recent = campaigns.slice(0, 15).map(c => `${c.name} (${c.status})`);
  lines.push(`Recent campaigns: ${recent.join(", ")}`);
  return lines.join("\n");
}

function summarizeSegments(segments: KlaviyoContext["segments"]): string {
  if (!segments?.length) return "No segments found in the account.";
  const names = segments.map(s => s.name);
  return `Total segments: ${segments.length}\nSegment names: ${names.join(", ")}`;
}

function summarizeForms(forms: KlaviyoContext["forms"]): string {
  if (!forms?.length) return "No signup forms found in the account.";
  const byStatus: Record<string, string[]> = {};
  for (const f of forms) {
    const s = (f.status || "unknown").toLowerCase();
    (byStatus[s] ??= []).push(f.name);
  }
  const lines = [`Total forms: ${forms.length}`];
  for (const [status, names] of Object.entries(byStatus)) {
    lines.push(`  ${status} (${names.length}): ${names.join(", ")}`);
  }
  return lines.join("\n");
}

function summarizeLists(lists: KlaviyoContext["lists"]): string {
  if (!lists?.length) return "No lists found.";
  return `Total lists: ${lists.length}\nList names: ${lists.map(l => l.name).join(", ")}`;
}

function summarizeFlowPerformance(perf: KlaviyoContext["flowPerformance"]): string {
  if (!perf?.length) return "No flow performance data available (metrics scope may be missing).";
  const lines = [`Flow performance data (last 30 days) for ${perf.length} flows:`];
  for (const fp of perf.slice(0, 20)) {
    const parts = [`${fp.flow_name} (${fp.flow_status})`];
    if (fp.email_message_count != null) parts.push(`emails_in_sequence: ${fp.email_message_count}`);
    if (fp.recipients_per_month) parts.push(`recipients: ${fp.recipients_per_month}`);
    if (fp.actual_open_rate != null) parts.push(`open: ${(fp.actual_open_rate * 100).toFixed(1)}%`);
    if (fp.actual_click_rate != null) parts.push(`click: ${(fp.actual_click_rate * 100).toFixed(1)}%`);
    if (fp.actual_conv_rate != null) parts.push(`conv: ${(fp.actual_conv_rate * 100).toFixed(1)}%`);
    if (fp.monthly_revenue_current) parts.push(`revenue: $${fp.monthly_revenue_current.toFixed(0)}`);
    lines.push(`  - ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildAuditUserPrompt(data: WizardData, klaviyo?: KlaviyoContext, mode: PromptMode = "full") {
  const requested = Array.isArray(data.requestedSectionKeys) && data.requestedSectionKeys.length > 0
    ? data.requestedSectionKeys
    : AUDIT_SECTION_KEYS;

  const klaviyoSection = klaviyo
    ? mode === "top_level_only"
      ? {
          account: klaviyo.account ?? null,
          flow_count: klaviyo.flows?.length ?? 0,
          campaign_count: klaviyo.campaigns?.length ?? 0,
          segment_count: klaviyo.segments?.length ?? 0,
          form_count: klaviyo.forms?.length ?? 0,
          top_flows: (klaviyo.flowPerformance ?? [])
            .slice(0, 8)
            .map((f) => ({
              name: f.flow_name,
              revenue: f.monthly_revenue_current ?? 0,
              recipients: f.recipients_per_month ?? 0,
              conv: f.actual_conv_rate ?? 0,
            })),
        }
      : {
          account: klaviyo.account ?? null,
          flows_summary: summarizeFlows(klaviyo.flows),
          campaigns_summary: summarizeCampaigns(klaviyo.campaigns),
          segments_summary: summarizeSegments(klaviyo.segments),
          forms_summary: summarizeForms(klaviyo.forms),
          lists_summary: summarizeLists(klaviyo.lists),
          flow_performance: summarizeFlowPerformance(klaviyo.flowPerformance),
        }
    : null;

  const payload: Record<string, unknown> = {
    task:
      mode === "sections_only"
        ? "Generate ONLY the requested audit sections below. Do NOT include executiveSummary, strengths, concerns, or implementationTimeline."
        : mode === "top_level_only"
          ? "Generate ONLY top-level findings (executiveSummary, strengths, concerns, implementationTimeline). Do NOT include section objects."
          : "Generate a full audit analysis based on the actual Klaviyo account data provided below.",
    client_info: {
      name: data.clientName || data.companyName,
      website: data.websiteUrl || klaviyo?.account?.website_url,
      esp: data.espPlatform || "Klaviyo",
      audit_method: data.auditMethod,
      notes: data.notes || undefined,
    },
    klaviyo_data: klaviyoSection,
    required_sections: mode === "top_level_only" ? [] : requested,
    style: {
      audience: "ecommerce founder/marketing lead",
      tone: "executive, practical, actionable",
      include_benchmarks: true,
    },
    constraints: {
      currency: "USD",
      no_negative_revenue_opportunity: true,
      revenue_realism: "revenue_opportunity is MONTHLY. Total across all 6 sections must NOT exceed the current monthly flow revenue. Per section: max 25% of current monthly flow revenue. For a $5K/mo account the total should be $2-4K/mo, NOT $50K+. When things look good, use $0-$200. Round DOWN when uncertain.",
      analyze_actual_data: "You MUST reference and analyze the actual Klaviyo data above. Do NOT claim data is missing if it is provided.",
      balanced_assessment: "If a section is healthy, say so and give it near-zero opportunity. Not every area needs a big number. Praise what works.",
    },
    section_rubric: {
      flows: "Cover Abandoned Cart, Browse Abandonment, Welcome Series, Post-Purchase, Winback/Re-engagement, Back-in-Stock (bonus), Sunset/List Cleaning (bonus).",
      segmentation: "Assess full-list vs segmented, engaged/unengaged definitions, VIP/high-LTV, and benchmark architecture.",
      campaigns: "Assess frequency consistency, segmented targeting, subject/preview hygiene, and campaign type mix.",
      signup_forms: "Assess popup + embedded presence, offer quality, mobile optimization, benchmark conversion framing.",
    },
  };

  if (mode !== "sections_only") {
    payload.required_top_level_fields = {
      strengths: "Array of 4-6 strings. Each is a specific positive finding with bold lead phrase and supporting data. Reference actual flow names, dollar amounts, percentages from the data.",
      concerns: "Array of 4-6 strings. Each is a specific issue or gap with bold lead phrase and evidence. Reference actual missing flows, underperforming metrics, inactive flows by name.",
      implementationTimeline: "Array of exactly 4 objects with {phase, timeframe, label, items}. Phase 1='Quick Wins' (Week 1-2), Phase 2='Core Flows' (Week 3-6), Phase 3='Strategic' (Month 2-3), Phase 4='Long-Term' (Month 3+). Items must be specific to this account's findings.",
    };
  }
  if (mode === "top_level_only") {
    payload.required_sections = [];
  }

  return JSON.stringify(payload, null, 2);
}

export function buildRepairUserPrompt(params: {
  failedSectionKeys: string[];
  originalInput: WizardData;
  previousOutput: unknown;
}) {
  return JSON.stringify(
    {
      task: "Regenerate only failed sections and keep schema compliance.",
      failed_sections: params.failedSectionKeys,
      original_input: params.originalInput,
      previous_output: params.previousOutput,
      instructions: [
        "Return a full valid object with all required sections.",
        "Prioritize section clarity, concrete opportunities, and valid numeric fields.",
      ],
    },
    null,
    2,
  );
}
