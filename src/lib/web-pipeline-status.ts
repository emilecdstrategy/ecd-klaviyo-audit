import { supabase } from './supabase';

/** One label per step of web_finalize_analysis (order must match STEPS there). */
export const WEB_STEP_LABELS = [
  'Analyzing homepage',
  'Analyzing product page',
  'Analyzing collection page',
  'Analyzing cart',
  'Reviewing store data',
  'Writing the overview',
  'Building the roadmap',
] as const;

const TOTAL_STEPS = WEB_STEP_LABELS.length;

export type WebPipelineStatus = {
  exists: boolean;
  isGenerating: boolean;
  failed: boolean;
  complete: boolean;
  error: string | null;
  stepIndex: number;
  progress: number;
  label: string;
};

export async function fetchWebAuditPipelineStatus(auditId: string): Promise<WebPipelineStatus> {
  const { data } = await supabase
    .from('audit_analysis_jobs')
    .select('status, step_index, error_message')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (!data) {
    return { exists: false, isGenerating: false, failed: false, complete: false, error: null, stepIndex: 0, progress: 0, label: '' };
  }
  const stepIndex = Math.max(0, Math.min(TOTAL_STEPS, Number(data.step_index) || 0));
  const complete = data.status === 'complete';
  const failed = data.status === 'failed';
  const isGenerating = data.status === 'pending' || data.status === 'running';
  const progress = complete ? 100 : Math.round((stepIndex / TOTAL_STEPS) * 100);
  const label = complete
    ? 'Done'
    : failed
      ? 'Analysis failed'
      : `${WEB_STEP_LABELS[Math.min(stepIndex, TOTAL_STEPS - 1)]}…`;
  return { exists: true, isGenerating, failed, complete, error: data.error_message ?? null, stepIndex, progress, label };
}

/** Kick the web analysis edge function. Races an 8s timeout so a slow first
 *  step doesn't block the caller; the job keeps running server-side. */
export async function startWebAnalysis(auditId: string, mode?: 'regenerate'): Promise<void> {
  const invokePromise = supabase.functions.invoke('web_finalize_analysis', {
    body: { audit_id: auditId, ...(mode ? { mode } : {}) },
  });
  const result = await Promise.race([
    invokePromise,
    new Promise<{ data: null; error: null }>((resolve) => window.setTimeout(() => resolve({ data: null, error: null }), 8_000)),
  ]);
  const err = (result as { error?: { message?: string; context?: { status?: number } } }).error;
  if (err) {
    const status = err.context?.status;
    if (Number(status) === 546 || Number(status) === 504) return;
    throw new Error(err.message || 'Failed to start web analysis');
  }
}
