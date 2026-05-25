import { supabase } from './supabase';
import type { Audit } from './types';

export type KlaviyoRunRow = {
  id: string;
  correlation_id: string;
  stage: string | null;
  status: string;
  elapsed_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export type AuditPipelinePhase =
  | 'starting'
  | 'klaviyo_config'
  | 'klaviyo_reporting'
  | 'profile_scan'
  | 'ai_analysis'
  | 'complete'
  | 'stalled';

export type AuditPipelineStatus = {
  isGenerating: boolean;
  isStalled: boolean;
  needsAiResume: boolean;
  phase: AuditPipelinePhase;
  progress: number;
  label: string;
  stageRuns: KlaviyoRunRow[];
  profileScanTotal: number | null;
};

const GENERATING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function auditHasAnalysisContent(
  executiveSummary: string | null | undefined,
  sections: Array<{ section_key?: string; summary_text?: string | null; human_edited_findings?: string | null }>,
): boolean {
  if (executiveSummary?.trim()) return true;
  return sections.some(section =>
    section.section_key !== 'revenue_summary'
    && Boolean(section.summary_text?.trim() || section.human_edited_findings?.trim()),
  );
}

/** Fast sync check for list views — no extra queries. */
export function isLikelyAuditGenerating(audit: Pick<Audit, 'audit_method' | 'executive_summary' | 'created_at'>): boolean {
  if (audit.audit_method !== 'api') return false;
  if (audit.executive_summary?.trim()) return false;
  const age = Date.now() - new Date(audit.created_at).getTime();
  return age >= 0 && age < GENERATING_MAX_AGE_MS;
}

export async function fetchAuditPipelineStatus(auditId: string): Promise<AuditPipelineStatus> {
  const [{ data: audit, error: auditErr }, { data: sections, error: sectionsErr }, { data: runs, error: runsErr }, { data: profileJob, error: profileErr }] = await Promise.all([
    supabase.from('audits').select('executive_summary, audit_method, created_at').eq('id', auditId).single(),
    supabase.from('audit_sections').select('section_key, summary_text, human_edited_findings').eq('audit_id', auditId),
    supabase
      .from('klaviyo_runs')
      .select('id, correlation_id, stage, status, elapsed_ms, error_code, error_message, created_at')
      .eq('audit_id', auditId)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('klaviyo_profile_scan_jobs')
      .select('status, total_profiles, subscribed, updated_at')
      .eq('audit_id', auditId)
      .maybeSingle(),
  ]);

  if (auditErr) throw auditErr;
  if (sectionsErr) throw sectionsErr;
  if (runsErr) throw runsErr;
  if (profileErr) throw profileErr;

  const stageRuns = (runs ?? []) as KlaviyoRunRow[];
  const sectionRows = sections ?? [];

  if (auditHasAnalysisContent(audit.executive_summary, sectionRows) || audit.audit_method !== 'api') {
    return {
      isGenerating: false,
      isStalled: false,
      needsAiResume: false,
      phase: 'complete',
      progress: 100,
      label: 'Analysis complete',
      stageRuns,
      profileScanTotal: profileJob?.total_profiles ?? null,
    };
  }

  const age = Date.now() - new Date(audit.created_at).getTime();

  const configRun = stageRuns.find(run => run.stage === 'config' || !run.stage);
  const reportingRun = stageRuns.find(run => run.stage === 'reporting');
  const reportingDone = reportingRun && ['success', 'partial', 'error', 'timeout'].includes(reportingRun.status);
  const profileActive = profileJob && ['pending', 'running'].includes(profileJob.status);
  const profileScanTotal = profileJob?.total_profiles != null ? Number(profileJob.total_profiles) : null;
  const klaviyoComplete = Boolean(
    configRun?.status === 'success' && reportingDone && !profileActive,
  );
  const isStale = !klaviyoComplete && age > STALE_AFTER_MS;

  let phase: AuditPipelinePhase = 'starting';
  let progress = 10;
  let label = 'Starting analysis…';

  if (!configRun) {
    phase = 'starting';
    progress = 10;
    label = 'Starting Klaviyo snapshot…';
  } else if (configRun.status === 'error' || configRun.status === 'timeout') {
    phase = 'klaviyo_config';
    progress = 18;
    label = 'Klaviyo config fetch had issues — retrying pipeline…';
  } else if (!reportingDone) {
    phase = 'klaviyo_reporting';
    progress = 30;
    label = 'Pulling Klaviyo reporting (flows & campaigns)…';
  } else if (profileActive) {
    phase = 'profile_scan';
    progress = 45;
    label = profileScanTotal && profileScanTotal > 0
      ? `Scanning Klaviyo profiles… ${profileScanTotal.toLocaleString()} scanned so far`
      : 'Scanning Klaviyo audience profiles…';
  } else {
    phase = 'ai_analysis';
    progress = 60;
    label = klaviyoComplete
      ? 'Klaviyo data ready — starting AI analysis…'
      : 'Running AI analysis and saving sections…';
  }

  const needsAiResume = klaviyoComplete;

  return {
    isGenerating: !isStale || needsAiResume,
    isStalled: isStale,
    needsAiResume,
    phase,
    progress,
    label,
    stageRuns,
    profileScanTotal,
  };
}

export const ACTIVE_AUDIT_GENERATION_KEY = 'ecd-active-audit-generation';

export function markAuditGenerationActive(auditId: string) {
  try {
    sessionStorage.setItem(ACTIVE_AUDIT_GENERATION_KEY, auditId);
  } catch {
    // ignore
  }
}

export function clearAuditGenerationActive(auditId?: string) {
  try {
    const current = sessionStorage.getItem(ACTIVE_AUDIT_GENERATION_KEY);
    if (!auditId || current === auditId) {
      sessionStorage.removeItem(ACTIVE_AUDIT_GENERATION_KEY);
    }
  } catch {
    // ignore
  }
}
