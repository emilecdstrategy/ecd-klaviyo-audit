import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildCompetingSmsKeyFinding,
  extractRecoveryFlowRevenue,
  injectCompetingSmsFinding,
} from "./competing-sms-finding.ts";
import type { CompetingSmsScanSnapshot } from "./competing-sms-scan.ts";
import {
  applyCoreFlowRecommendationsToSectionDetails,
  fetchCoreFlowRecommendations,
} from "./core-flow-recommendations.ts";

const REVENUE_SECTION_KEYS = ["flows", "segmentation", "campaigns", "signup_forms", "email_design"];

export function defaultEmailDesignRevenue(totalExcludingEmail: number): number {
  return Math.max(300, Math.round(totalExcludingEmail * 0.1));
}

function sectionVisible(sectionKey: string, sectionConfig: unknown): boolean {
  if (!sectionConfig || typeof sectionConfig !== "object") return true;
  const hidden = (sectionConfig as Record<string, unknown>).hidden;
  return hidden !== true;
}

export function computeAuditTotalRevenueOpportunity(
  sections: Array<{ section_key?: string; revenue_opportunity?: number; section_config?: unknown }>,
  layout: unknown,
): number {
  const sectionTotal = sections
    .filter((s) => s.section_key && REVENUE_SECTION_KEYS.includes(s.section_key))
    .filter((s) => sectionVisible(s.section_key!, s.section_config ?? null))
    .reduce((sum, s) => sum + (Number(s.revenue_opportunity) || 0), 0);

  const layoutObj = (layout as Record<string, unknown> | null | undefined) ?? {};
  const revenueSummary = layoutObj.revenue_summary as Record<string, unknown> | undefined;
  const blocks = revenueSummary?.blocks as Record<string, unknown> | undefined;
  const addOns = blocks?.addOns as Record<string, unknown> | undefined;
  const items = Array.isArray(addOns?.items) ? addOns.items as Array<{ revenue_monthly?: number; is_hidden?: boolean }> : [];
  const addOnTotal = items
    .filter((item) => item && !item.is_hidden)
    .reduce((sum, item) => sum + (Number(item.revenue_monthly) || 0), 0);
  return sectionTotal + addOnTotal;
}

export type AddOnPlacementPersist = {
  template_slug: string;
  section_keys: string[];
  presenter_note: string;
};

type PartialState = {
  executiveSummary?: string;
  findings?: string[];
  strengths?: string[];
  implementationTimeline?: unknown[];
  sections?: Array<Record<string, unknown>>;
  addOnPlacements?: AddOnPlacementPersist[];
};

function mergeAddOnPlacementsIntoLayout(
  layout: unknown,
  placements: AddOnPlacementPersist[] | undefined,
  options?: { clearUnplaced?: boolean },
): Record<string, unknown> {
  const layoutObj = { ...((layout as Record<string, unknown> | null | undefined) ?? {}) };
  const revenueSummary = { ...((layoutObj.revenue_summary as Record<string, unknown> | undefined) ?? {}) };
  const blocks = { ...((revenueSummary.blocks as Record<string, unknown> | undefined) ?? {}) };
  const addOns = { ...((blocks.addOns as Record<string, unknown> | undefined) ?? {}) };
  const items = Array.isArray(addOns.items) ? [...(addOns.items as Array<Record<string, unknown>>)] : [];

  if (!placements?.length) {
    if (!options?.clearUnplaced || items.length === 0) return layoutObj;
    for (let i = 0; i < items.length; i++) {
      const { related_section_keys: _r, presenter_note: _p, ...rest } = items[i];
      items[i] = rest;
    }
    addOns.items = items;
    blocks.addOns = addOns;
    revenueSummary.blocks = blocks;
    layoutObj.revenue_summary = revenueSummary;
    return layoutObj;
  }

  const bySlug = new Map(placements.map((p) => [p.template_slug, p]));

  for (let i = 0; i < items.length; i++) {
    const slug = String(items[i]?.template_slug ?? "").trim();
    const placement = bySlug.get(slug);
    if (placement) {
      items[i] = {
        ...items[i],
        related_section_keys: placement.section_keys,
        presenter_note: placement.presenter_note,
      };
    } else if (options?.clearUnplaced) {
      const { related_section_keys: _r, presenter_note: _p, ...rest } = items[i];
      items[i] = rest;
    }
  }

  addOns.items = items;
  blocks.addOns = addOns;
  revenueSummary.blocks = blocks;
  layoutObj.revenue_summary = revenueSummary;
  return layoutObj;
}

export async function persistAuditAnalysisResults(
  sb: SupabaseClient,
  auditId: string,
  partial: PartialState,
  options?: {
    patchOnlySectionKeys?: string[];
    preserveStrengthsFromAudit?: boolean;
  },
): Promise<void> {
  const { data: audit, error: auditErr } = await sb
    .from("audits")
    .select("id, layout, client_id, executive_summary")
    .eq("id", auditId)
    .single();
  if (auditErr || !audit) throw auditErr ?? new Error("Audit not found");

  let preservedStrengths: string[] | null = null;
  if (options?.preserveStrengthsFromAudit) {
    try {
      const parsed = JSON.parse(String(audit.executive_summary ?? ""));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.strengths)) {
        preservedStrengths = parsed.strengths.map((s: string) => String(s));
      }
    } catch {
      preservedStrengths = null;
    }
  }

  const strengthsForExec = preservedStrengths ?? (partial.strengths ?? []);

  const { data: sectionRows, error: sectionsErr } = await sb
    .from("audit_sections")
    .select("id, section_key, revenue_opportunity, section_config")
    .eq("audit_id", auditId);
  if (sectionsErr) throw sectionsErr;

  const recommendations = await fetchCoreFlowRecommendations(sb);
  const patches = (partial.sections ?? []).map((patch) => {
    let next: Record<string, unknown> = { ...patch };
    const rawKf = (patch as { key_findings?: { items?: string[] } }).key_findings;
    if (rawKf?.items?.length) {
      next = {
        ...next,
        key_findings: {
          items: rawKf.items.map((item) => String(item).trim()).filter(Boolean),
          items_hidden: rawKf.items.map(() => false),
        },
      };
    }
    if (String(patch.section_key) !== "flows" || !patch.section_details) return next;
    return {
      ...next,
      section_details: applyCoreFlowRecommendationsToSectionDetails(
        patch.section_details,
        recommendations,
      ),
    };
  });
  const patchByKey = new Map(patches.map((p) => [String(p.section_key), p]));
  const patchOnly = options?.patchOnlySectionKeys?.length
    ? new Set(options.patchOnlySectionKeys)
    : null;

  for (const section of sectionRows ?? []) {
    const patch = patchByKey.get(section.section_key);
    if (!patch || section.section_key === "email_design") continue;
    if (patchOnly && !patchOnly.has(section.section_key)) continue;
    const { section_key: _sk, ...rest } = patch;
    await sb.from("audit_sections").update(rest).eq("id", section.id);
  }

  const mergedSections = (sectionRows ?? []).map((section) => {
    const patch = patchByKey.get(section.section_key);
    if (!patch) return section;
    if (patchOnly && !patchOnly.has(section.section_key)) return section;
    return { ...section, ...patch };
  });

  const opportunityBaseBeforeEmail = computeAuditTotalRevenueOpportunity(
    mergedSections.map((s) =>
      s.section_key === "email_design" ? { ...s, revenue_opportunity: 0 } : s,
    ),
    audit.layout,
  );

  const emailSection = (sectionRows ?? []).find((s) => s.section_key === "email_design");
  const emailPatch = patchByKey.get("email_design");
  if (emailSection && emailPatch && (!patchOnly || patchOnly.has("email_design"))) {
    const aiEmailRevenue = Number(emailPatch.revenue_opportunity) || 0;
    const emailRevenue = aiEmailRevenue > 0
      ? aiEmailRevenue
      : defaultEmailDesignRevenue(opportunityBaseBeforeEmail);
    const { section_key: _sk, ...rest } = emailPatch;
    await sb.from("audit_sections").update({ ...rest, revenue_opportunity: emailRevenue }).eq("id", emailSection.id);
  }

  const patchedSections = mergedSections.map((section) => {
    const patch = patchByKey.get(section.section_key);
    if (!patch) return section;
    if (patchOnly && !patchOnly.has(section.section_key)) return section;
    if (section.section_key === "email_design") {
      const aiEmailRevenue = Number(patch.revenue_opportunity) || 0;
      return {
        ...section,
        ...patch,
        revenue_opportunity: aiEmailRevenue > 0
          ? aiEmailRevenue
          : defaultEmailDesignRevenue(opportunityBaseBeforeEmail),
      };
    }
    return { ...section, ...patch };
  });

  const mergedLayout = mergeAddOnPlacementsIntoLayout(
    audit.layout,
    partial.addOnPlacements,
    { clearUnplaced: Boolean(options?.preserveStrengthsFromAudit) },
  );
  const totalOpportunity = computeAuditTotalRevenueOpportunity(patchedSections, mergedLayout);

  let findingsForExec = partial.findings ?? [];
  try {
    const { data: rollup } = await sb
      .from("klaviyo_reporting_rollups")
      .select("computed")
      .eq("audit_id", auditId)
      .eq("timeframe_key", "last_30_days")
      .maybeSingle();
    const snapshot = (rollup?.computed as { account_snapshot?: { competing_sms_scan?: CompetingSmsScanSnapshot } } | null)
      ?.account_snapshot;
    const scan = snapshot?.competing_sms_scan;
    if (scan?.should_inject_finding && scan.detected_platforms?.length) {
      const { data: flowPerf } = await sb
        .from("flow_performance")
        .select("flow_name, monthly_revenue_current")
        .eq("audit_id", auditId);
      const recovery = extractRecoveryFlowRevenue(flowPerf ?? []);
      const finding = buildCompetingSmsKeyFinding(scan.detected_platforms, recovery);
      findingsForExec = injectCompetingSmsFinding(findingsForExec, finding);
    }
  } catch {
    // non-critical
  }

  const execPayload = (strengthsForExec.length || findingsForExec.length || partial.implementationTimeline?.length)
    ? JSON.stringify({
      text: partial.executiveSummary ?? "",
      findings: findingsForExec,
      strengths: strengthsForExec,
      timeline: partial.implementationTimeline ?? [],
    })
    : (partial.executiveSummary ?? "");

  await sb.from("audits").update({
    executive_summary: execPayload,
    layout: mergedLayout,
    total_revenue_opportunity: totalOpportunity,
    updated_at: new Date().toISOString(),
  }).eq("id", auditId);

  try {
    const { data: client } = await sb.from("clients").select("industry").eq("id", audit.client_id).maybeSingle();
    const industry = (client?.industry ?? "").trim();
    if (industry && !patchOnly) {
      const { data: ecdExample } = await sb
        .from("industry_email_library")
        .select("id, default_annotations")
        .eq("industry", industry)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ecdExample) {
        await sb.from("audit_email_design").upsert({
          audit_id: auditId,
          ecd_example_id: ecdExample.id,
        }, { onConflict: "audit_id" });
        const emailDesignSection = (sectionRows ?? []).find((s) => s.section_key === "email_design");
        const annotations = Array.isArray(ecdExample.default_annotations) ? ecdExample.default_annotations : [];
        if (emailDesignSection && annotations.length) {
          for (const ann of annotations as Array<{ x: number; y: number; label: string }>) {
            await sb.from("annotations").insert({
              audit_section_id: emailDesignSection.id,
              asset_id: null,
              x_position: ann.x,
              y_position: ann.y,
              label: ann.label,
              side: "optimized",
            });
          }
        }
      }
    }
  } catch {
    // non-critical
  }
}
