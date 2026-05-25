import { runAIAnalysis } from './ai-service';
import {
  createAnnotation,
  getClient,
  getIndustryEmailByIndustry,
  listAuditSections,
  updateAudit,
  updateAuditSection,
  upsertAuditEmailDesign,
} from './db';
import { normalizeFlowsSectionPatch } from './core-flows-matrix';
import {
  clearAuditGenerationActive,
  fetchAuditPipelineStatus,
  markAuditGenerationActive,
} from './audit-pipeline-status';
import {
  computeAuditTotalRevenueOpportunity,
  defaultEmailDesignRevenue,
} from './revenue-calculator';
import { supabase } from './supabase';
import type { Audit, AuditContext, AuditSection } from './types';

const RESUME_LOCK_PREFIX = 'ecd-ai-resume-lock:';

function resumeLockKey(auditId: string) {
  return `${RESUME_LOCK_PREFIX}${auditId}`;
}

export function isAuditAiResumeInFlight(auditId: string): boolean {
  try {
    return sessionStorage.getItem(resumeLockKey(auditId)) === '1';
  } catch {
    return false;
  }
}

function setAuditAiResumeInFlight(auditId: string, inFlight: boolean) {
  try {
    if (inFlight) sessionStorage.setItem(resumeLockKey(auditId), '1');
    else sessionStorage.removeItem(resumeLockKey(auditId));
  } catch {
    // ignore
  }
}

export type ResumeAuditProgress = {
  label: string;
  progress: number;
};

export async function resumeAuditAnalysis(
  auditId: string,
  onProgress?: (update: ResumeAuditProgress) => void,
): Promise<void> {
  if (isAuditAiResumeInFlight(auditId)) return;

  const pipeline = await fetchAuditPipelineStatus(auditId);
  if (!pipeline.needsAiResume) return;

  setAuditAiResumeInFlight(auditId, true);
  markAuditGenerationActive(auditId);

  try {
    onProgress?.({ label: 'Loading audit data…', progress: 62 });

    const [{ data: audit, error: auditErr }, sections, client] = await Promise.all([
      supabase.from('audits').select('*').eq('id', auditId).single(),
      listAuditSections(auditId),
      (async () => {
        const { data: auditRow } = await supabase.from('audits').select('client_id').eq('id', auditId).single();
        if (!auditRow?.client_id) return null;
        return getClient(auditRow.client_id);
      })(),
    ]);

    if (auditErr || !audit) throw auditErr ?? new Error('Audit not found');
    if (!client) throw new Error('Client not found');

    const auditRow = audit as Audit;
    const context = (auditRow.context ?? null) as AuditContext | null;
    const layout = auditRow.layout ?? undefined;
    const clientSellsSubscriptions = Boolean(context?.sells_subscriptions);

    const { data: profileJob } = await supabase
      .from('klaviyo_profile_scan_jobs')
      .select('status')
      .eq('audit_id', auditId)
      .maybeSingle();

    let profileAudienceScan: 'full' | 'skipped' | 'timed_out' = 'full';
    if (!profileJob) {
      profileAudienceScan = 'skipped';
    } else if (profileJob.status === 'skipped') {
      profileAudienceScan = 'skipped';
    } else if (profileJob.status === 'complete') {
      profileAudienceScan = 'full';
    }

    onProgress?.({ label: 'Running AI analysis…', progress: 65 });

    const ai = await runAIAnalysis(
      {
        auditId,
        clientId: client.id,
        clientName: client.name,
        companyName: client.company_name,
        industry: client.industry,
        espPlatform: client.esp_platform || 'Klaviyo',
        websiteUrl: client.website_url || '',
        listSize: Math.round(Number(auditRow.list_size) || 0),
        aov: Math.round(Number(auditRow.aov) || 0),
        monthlyTraffic: Math.round(Number(auditRow.monthly_traffic) || 0),
        notes: client.notes || '',
        auditMethod: 'api',
        auditContext: context ?? undefined,
        profileAudienceScan,
        clientSellsSubscriptions,
      },
      update => {
        if (update.total > 0) {
          const mapped = 65 + Math.round((update.current / update.total) * 25);
          onProgress?.({ label: update.label, progress: Math.min(mapped, 90) });
        } else if (update.label) {
          onProgress?.({ label: update.label, progress: 70 });
        }
      },
    );

    onProgress?.({ label: 'Saving results…', progress: 92 });

    const patchByKey = new Map(ai.sections.map(patch => [patch.section_key, patch]));

    for (const section of sections) {
      const patch = patchByKey.get(section.section_key);
      if (!patch || section.section_key === 'email_design') continue;
      const normalizedPatch = section.section_key === 'flows'
        ? normalizeFlowsSectionPatch(patch as { section_details?: unknown }, {
            includeSubscription: clientSellsSubscriptions,
          })
        : patch;
      await updateAuditSection(section.id, normalizedPatch as Partial<AuditSection>);
    }

    const sectionsForOpportunityBase = sections.map(section => {
      const patch = patchByKey.get(section.section_key);
      const merged = patch ? { ...section, ...patch } : section;
      if (section.section_key === 'email_design') {
        return { ...merged, revenue_opportunity: 0 };
      }
      return merged;
    });
    const opportunityBaseBeforeEmail = computeAuditTotalRevenueOpportunity(
      sectionsForOpportunityBase,
      layout,
    );

    const emailSection = sections.find(section => section.section_key === 'email_design');
    const emailPatch = patchByKey.get('email_design');
    if (emailSection && emailPatch) {
      const aiEmailRevenue = Number(emailPatch.revenue_opportunity) || 0;
      const emailRevenue = aiEmailRevenue > 0
        ? aiEmailRevenue
        : defaultEmailDesignRevenue(opportunityBaseBeforeEmail);
      await updateAuditSection(emailSection.id, {
        ...emailPatch,
        revenue_opportunity: emailRevenue,
      } as Partial<AuditSection>);
    }

    const patchedSections = sections.map(section => {
      const patch = patchByKey.get(section.section_key);
      if (!patch) return section;
      if (section.section_key === 'email_design') {
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

    const totalOpportunity = computeAuditTotalRevenueOpportunity(patchedSections, layout);

    const execPayload = (ai.strengths?.length || ai.findings?.length || ai.implementationTimeline?.length)
      ? JSON.stringify({
          text: ai.executiveSummary,
          findings: ai.findings ?? [],
          strengths: ai.strengths ?? [],
          timeline: ai.implementationTimeline ?? [],
        })
      : ai.executiveSummary;

    await updateAudit(auditId, {
      executive_summary: execPayload,
      total_revenue_opportunity: totalOpportunity,
    } as Partial<Audit>);

    try {
      const industry = client.industry || '';
      if (industry) {
        const ecdExample = await getIndustryEmailByIndustry(industry);
        if (ecdExample) {
          await upsertAuditEmailDesign(auditId, { ecd_example_id: ecdExample.id });
          if (emailSection && ecdExample.default_annotations?.length) {
            for (const ann of ecdExample.default_annotations) {
              await createAnnotation({
                audit_section_id: emailSection.id,
                asset_id: null,
                x_position: ann.x,
                y_position: ann.y,
                label: ann.label,
                side: 'optimized',
              });
            }
          }
        }
      }
    } catch {
      // non-critical
    }

    onProgress?.({ label: 'Done', progress: 100 });
    clearAuditGenerationActive(auditId);
  } finally {
    setAuditAiResumeInFlight(auditId, false);
  }
}
