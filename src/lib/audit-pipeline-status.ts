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
  /** True when the profile scan job exists but is not complete yet. */
  needsProfileResume: boolean;
  /** True when Klaviyo data is ready but AI has not finished writing sections. */
  needsAiResume: boolean;
  /** Show the in-progress / resume UI instead of an empty report shell. */
  showPipelineUi: boolean;
  aiServerActive: boolean;
  aiJobFailed: boolean;
  aiJobError: string | null;
  phase: AuditPipelinePhase;
  progress: number;
  label: string;
  stageRuns: KlaviyoRunRow[];
  profileScanTotal: number | null;
  profileStalled: boolean;
  aiStalled: boolean;
};

const GENERATING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PROFILE_NUDGE_STALE_MS = 90_000;
/** Only show the manual "paused" UI after this long without profile progress. */
const PROFILE_PAUSED_STALE_MS = 5 * 60 * 1000;

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
  const [{ data: audit, error: auditErr }, { data: sections, error: sectionsErr }, { data: runs, error: runsErr }, { data: profileJob, error: profileErr }, { data: aiJob, error: aiJobErr }] = await Promise.all([
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
    supabase
      .from('audit_analysis_jobs')
      .select('status, step_index, error_message, updated_at')
      .eq('audit_id', auditId)
      .maybeSingle(),
  ]);

  if (auditErr) throw auditErr;
  if (sectionsErr) throw sectionsErr;
  if (runsErr) throw runsErr;
  if (profileErr) throw profileErr;
  // aiJobErr is non-fatal before migration is applied everywhere
  if (aiJobErr && aiJobErr.code !== 'PGRST205') throw aiJobErr;

  const stageRuns = (runs ?? []) as KlaviyoRunRow[];
  const sectionRows = sections ?? [];

  if (auditHasAnalysisContent(audit.executive_summary, sectionRows) || audit.audit_method !== 'api') {
    return {
      isGenerating: false,
      isStalled: false,
      needsProfileResume: false,
      needsAiResume: false,
      showPipelineUi: false,
      aiServerActive: false,
      aiJobFailed: false,
      aiJobError: null,
      phase: 'complete',
      progress: 100,
      label: 'Analysis complete',
      stageRuns,
      profileScanTotal: profileJob?.total_profiles ?? null,
      profileStalled: false,
      aiStalled: false,
    };
  }

  const aiJobStatus = aiJob?.status ?? null;
  const aiJobUpdatedMs = aiJob?.updated_at ? new Date(aiJob.updated_at).getTime() : null;
  const aiJobStale = Boolean(
    aiJob
    && ['pending', 'running'].includes(aiJob.status)
    && aiJobUpdatedMs
    && Date.now() - aiJobUpdatedMs > PROFILE_PAUSED_STALE_MS,
  );
  const aiServerActive = (aiJobStatus === 'pending' || aiJobStatus === 'running') && !aiJobStale;
  const aiJobFailed = aiJobStatus === 'failed';
  const aiJobError = aiJobFailed ? (aiJob?.error_message ?? 'AI analysis failed') : null;

  const configRun = stageRuns.find(run => run.stage === 'config' || !run.stage);
  const reportingRun = stageRuns.find(run => run.stage === 'reporting');
  const reportingDone = reportingRun && ['success', 'partial', 'error', 'timeout'].includes(reportingRun.status);
  const profileActive = profileJob && ['pending', 'running'].includes(profileJob.status);
  const profileScanTotal = profileJob?.total_profiles != null ? Number(profileJob.total_profiles) : null;
  const profileUpdatedMs = profileJob?.updated_at ? new Date(profileJob.updated_at).getTime() : null;
  const profileChainStale = Boolean(
    profileActive
    && profileUpdatedMs
    && Date.now() - profileUpdatedMs > PROFILE_NUDGE_STALE_MS,
  );
  const profilePaused = Boolean(
    profileActive
    && profileUpdatedMs
    && Date.now() - profileUpdatedMs > PROFILE_PAUSED_STALE_MS,
  );
  const klaviyoComplete = Boolean(
    configRun?.status === 'success' && reportingDone && !profileActive,
  );
  const needsProfileResume = Boolean(profileActive);

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
    if (aiServerActive) {
      const stepIndex = Number(aiJob?.step_index) || 0;
      progress = 62 + Math.min(33, stepIndex * 4);
      label = 'Running AI analysis on server…';
    } else if (klaviyoComplete) {
      label = aiJobFailed
        ? 'AI analysis failed — retrying…'
        : 'Klaviyo data ready — starting AI analysis on server…';
    } else {
      label = 'Running AI analysis and saving sections…';
    }
  }

  const needsAiResume = klaviyoComplete && !aiServerActive && !aiJobFailed;
  const showPipelineUi = needsProfileResume || needsAiResume || aiJobFailed || aiServerActive;
  const aiStalled = Boolean(aiJobStale && klaviyoComplete && aiJobStatus !== 'complete');

  return {
    isGenerating: showPipelineUi && !profilePaused && !aiStalled,
    isStalled: profilePaused || aiStalled,
    needsProfileResume,
    needsAiResume: needsAiResume || aiJobFailed,
    showPipelineUi,
    aiServerActive,
    aiJobFailed,
    aiJobError,
    phase,
    progress,
    label: profileChainStale && phase === 'profile_scan'
      ? `${label} (resuming on server…)`
      : label,
    stageRuns,
    profileScanTotal,
    profileStalled: profilePaused,
    aiStalled,
  };
}

/** Kick the server-side profile scan chain (returns once the worker is dispatched). */
export async function nudgeProfileScan(auditId: string): Promise<void> {
  await supabase.auth.refreshSession().catch(() => {});
  const invokePromise = supabase.functions.invoke('klaviyo_fetch_snapshot', {
    body: { stage: 'resume_profile_scan', audit_id: auditId },
  });
  const result = await Promise.race([
    invokePromise,
    new Promise<{ data: null; error: null }>(resolve => {
      window.setTimeout(() => resolve({ data: null, error: null }), 8_000);
    }),
  ]);

  if (result.error) {
    const status = (result.error as { context?: { status?: number } }).context?.status;
    // Edge worker still running past gateway timeout — scan continues server-side.
    if (Number(status) === 546 || Number(status) === 504) return;
    throw new Error(result.error.message || 'Failed to resume profile scan');
  }
}

export async function startServerAuditAnalysis(auditId: string): Promise<void> {
  const invokePromise = supabase.functions.invoke('audit_finalize_analysis', {
    body: { audit_id: auditId },
  });
  const result = await Promise.race([
    invokePromise,
    new Promise<{ data: null; error: null }>(resolve => {
      window.setTimeout(() => resolve({ data: null, error: null }), 8_000);
    }),
  ]);

  if (result.error) {
    const status = (result.error as { context?: { status?: number } }).context?.status;
    if (Number(status) === 546 || Number(status) === 504) return;
    throw new Error(result.error.message || 'Failed to start server AI analysis');
  }
}

export async function waitForServerAuditAnalysis(
  auditId: string,
  options?: {
    onUpdate?: (label: string, progress: number) => void;
    maxWaitMs?: number;
  },
): Promise<void> {
  const started = Date.now();
  const maxWait = options?.maxWaitMs ?? GENERATING_MAX_AGE_MS;
  let nudgeSent = false;

  while (Date.now() - started < maxWait) {
    const status = await fetchAuditPipelineStatus(auditId);
    options?.onUpdate?.(status.label, status.progress);
    if (!status.isGenerating && status.phase === 'complete') return;
    if (status.aiJobFailed && nudgeSent) {
      throw new Error(status.aiJobError ?? 'AI analysis failed on server');
    }
    if ((status.needsAiResume || status.aiJobFailed) && !status.aiServerActive) {
      if (!nudgeSent || status.aiJobFailed) {
        nudgeSent = true;
        await startServerAuditAnalysis(auditId);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Timed out waiting for AI analysis');
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
