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
  }>;
};

export function buildAuditSystemPrompt() {
  return [
    "You are a principal Klaviyo lifecycle strategist and conversion auditor.",
    "You have been given detailed data pulled directly from the client's Klaviyo account via the API.",
    "Analyze the ACTUAL data provided — do NOT say data is missing if it is present in the input.",
    "Return only valid JSON matching the provided schema.",
    `Set schemaVersion to '${AI_SCHEMA_VERSION}'.`,
    "Use crisp, client-facing writing with concrete findings and realistic revenue opportunities.",
    "Reference specific flow names, campaign names, segment names, and form names from the data.",
    "Do not use placeholders, hedging, or vague generic statements.",
  ].join(" ");
}

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
    if (fp.recipients_per_month) parts.push(`recipients: ${fp.recipients_per_month}`);
    if (fp.actual_open_rate != null) parts.push(`open: ${(fp.actual_open_rate * 100).toFixed(1)}%`);
    if (fp.actual_click_rate != null) parts.push(`click: ${(fp.actual_click_rate * 100).toFixed(1)}%`);
    if (fp.actual_conv_rate != null) parts.push(`conv: ${(fp.actual_conv_rate * 100).toFixed(1)}%`);
    if (fp.monthly_revenue_current) parts.push(`revenue: $${fp.monthly_revenue_current.toFixed(0)}`);
    lines.push(`  - ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildAuditUserPrompt(data: WizardData, klaviyo?: KlaviyoContext) {
  const requested = Array.isArray(data.requestedSectionKeys) && data.requestedSectionKeys.length > 0
    ? data.requestedSectionKeys
    : AUDIT_SECTION_KEYS;

  const klaviyoSection = klaviyo ? {
    account: klaviyo.account ?? null,
    flows_summary: summarizeFlows(klaviyo.flows),
    campaigns_summary: summarizeCampaigns(klaviyo.campaigns),
    segments_summary: summarizeSegments(klaviyo.segments),
    forms_summary: summarizeForms(klaviyo.forms),
    lists_summary: summarizeLists(klaviyo.lists),
    flow_performance: summarizeFlowPerformance(klaviyo.flowPerformance),
  } : null;

  return JSON.stringify(
    {
      task: "Generate a full audit analysis based on the actual Klaviyo account data provided below.",
      client_info: {
        name: data.clientName || data.companyName,
        website: data.websiteUrl || klaviyo?.account?.website_url,
        esp: data.espPlatform || "Klaviyo",
        audit_method: data.auditMethod,
        notes: data.notes || undefined,
      },
      klaviyo_data: klaviyoSection,
      required_sections: requested,
      style: {
        audience: "ecommerce founder/marketing lead",
        tone: "executive, practical",
        include_benchmarks: true,
      },
      constraints: {
        currency: "USD",
        no_negative_revenue_opportunity: true,
        analyze_actual_data: "You MUST reference and analyze the actual Klaviyo data above. Do NOT claim data is missing if it is provided.",
      },
    },
    null,
    2,
  );
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
