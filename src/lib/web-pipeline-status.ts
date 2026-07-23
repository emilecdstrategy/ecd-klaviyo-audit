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

/** Generate (or regenerate) the AI "after" concept image for one page section.
 *  Returns the new image URL (and the viewport it was made for), or throws with
 *  a readable message the report can surface. Image editing can take a while, so
 *  no client timeout: the caller shows its own spinner. */
export async function generateSectionAfter(
  auditId: string,
  sectionKey: string,
  viewport?: 'desktop' | 'mobile',
): Promise<{ url: string; viewport: 'desktop' | 'mobile' }> {
  const { data, error } = await supabase.functions.invoke('web_generate_after', {
    body: { audit_id: auditId, section_key: sectionKey, ...(viewport ? { viewport } : {}) },
  });
  if (error) throw new Error(error.message || 'Failed to generate the after image');
  const res = data as { ok?: boolean; url?: string; viewport?: string; error?: { message?: string } };
  if (!res?.ok || !res.url) throw new Error(res?.error?.message || 'Could not generate the after image.');
  return { url: res.url, viewport: res.viewport === 'mobile' ? 'mobile' : 'desktop' };
}

/** Fetch just the current after-image URLs for a section (used to poll the
 * report so auto-generated afters appear without a manual refresh). */
export async function fetchSectionAfterImages(
  sectionId: string,
): Promise<{ desktop?: string; mobile?: string }> {
  const { data } = await supabase
    .from('audit_sections')
    .select('section_details')
    .eq('id', sectionId)
    .maybeSingle();
  const web = ((data?.section_details as Record<string, unknown> | null | undefined)?.web ?? {}) as Record<string, unknown>;
  const ai = (web.after_images ?? {}) as Record<string, { url?: string } | undefined>;
  const out: { desktop?: string; mobile?: string } = {};
  if (ai.desktop?.url) out.desktop = ai.desktop.url;
  if (ai.mobile?.url) out.mobile = ai.mobile.url;
  return out;
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
