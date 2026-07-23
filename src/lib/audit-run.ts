// The audit "run" pipeline, extracted from the New Audit wizard so it can be
// triggered from the audit workspace (the wizard now only creates a draft audit;
// capture/analysis happens later from the workspace). Operates on an existing
// audit id. Edge functions are unchanged; this is the client-side orchestration.
import { supabase } from './supabase';
import { updateAudit } from './db';
import { nudgeProfileScan, waitForServerAuditAnalysis } from './audit-pipeline-status';
import { startWebAnalysis } from './web-pipeline-status';
import type { Audit } from './types';

export type RunProgress = (progress: number, stage: string) => void;

async function invokeKlaviyoSnapshot(body: Record<string, unknown>) {
  await supabase.auth.refreshSession().catch(() => {});
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please refresh the page, sign in again, and retry.');
  }
  return supabase.functions.invoke<any>('klaviyo_fetch_snapshot', { body });
}

type KlaviyoRunRow = {
  id: string;
  correlation_id: string;
  stage: string | null;
  status: string;
  elapsed_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

async function waitForReportingStage(auditId: string): Promise<'success' | 'partial' | 'error' | 'timed_out'> {
  const maxMs = 10 * 60 * 1000;
  const t0 = Date.now();
  let lastNudge = 0;
  while (Date.now() - t0 < maxMs) {
    const { data } = await supabase
      .from('klaviyo_runs')
      .select('id, correlation_id, stage, status, elapsed_ms, error_code, error_message, created_at')
      .eq('audit_id', auditId)
      .eq('stage', 'reporting')
      .order('created_at', { ascending: false })
      .limit(1);
    const latest = (data?.[0] ?? null) as KlaviyoRunRow | null;
    if (latest?.status === 'success' || latest?.status === 'partial') return latest.status as 'success' | 'partial';
    if (latest?.status === 'error' || latest?.status === 'timeout') return 'error';
    if (!latest && Date.now() - t0 > 120_000 && Date.now() - lastNudge > 90_000) {
      lastNudge = Date.now();
      invokeKlaviyoSnapshot({ stage: 'reporting', audit_id: auditId }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'timed_out';
}

async function waitForProfileJobComplete(
  auditId: string,
  onProgress?: (totalProfiles: number) => void,
): Promise<'complete' | 'skipped' | 'timed_out'> {
  const maxMs = 4 * 60 * 60 * 1000;
  const t0 = Date.now();
  let lastUpdated = '';
  let staleCount = 0;
  let lastResumeAssist = 0;
  while (Date.now() - t0 < maxMs) {
    const { data, error } = await supabase
      .from('klaviyo_profile_scan_jobs')
      .select('status, error_message, total_profiles, subscribed, updated_at')
      .eq('audit_id', auditId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Profile scan job not found');
    if (data.status === 'complete') { onProgress?.(data.total_profiles ?? 0); return 'complete'; }
    if (data.status === 'skipped') { onProgress?.(data.total_profiles ?? 0); return 'skipped'; }
    if (data.status === 'failed') throw new Error(data.error_message || 'Audience metrics scan failed');
    onProgress?.(data.total_profiles ?? 0);
    if (data.updated_at === lastUpdated) staleCount++;
    else { staleCount = 0; lastUpdated = data.updated_at ?? ''; }
    if (staleCount >= 3) { staleCount = 0; nudgeProfileScan(auditId).catch(() => {}); }
    if (Date.now() - lastResumeAssist > 90_000) { lastResumeAssist = Date.now(); nudgeProfileScan(auditId).catch(() => {}); }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'timed_out';
}

/** Run the full Klaviyo audit pipeline for an existing draft audit. Uses the
 * client's saved Klaviyo connection unless a one-time apiKey is supplied. */
export async function runKlaviyoAudit(
  auditId: string,
  clientId: string,
  opts: { apiKey?: string; onProgress?: RunProgress } = {},
): Promise<void> {
  const progress = opts.onProgress ?? (() => {});

  progress(20, 'Stage 1/3: Fetching Klaviyo config…');
  const snapshotPayload = {
    audit_id: auditId,
    client_id: clientId,
    api_key: opts.apiKey || undefined,
    stage: 'config' as const,
    profile_scan: 'full' as const,
  };
  const invokeSnapshot = () => invokeKlaviyoSnapshot(snapshotPayload);
  let { data, error: fnErr } = await invokeSnapshot();
  if (fnErr) {
    const firstAnyErr = fnErr as any;
    const firstStatus = firstAnyErr?.context?.status ?? firstAnyErr?.status ?? null;
    const errMsg = String(fnErr.message || '').toLowerCase();
    const isRetryable =
      Number(firstStatus) === 546 || errMsg.includes('status 546') ||
      Number(firstStatus) === 504 || errMsg.includes('status 504') ||
      errMsg.includes('failed to send') || errMsg.includes('networkerror') ||
      errMsg.includes('failed to fetch');
    if (isRetryable) {
      progress(20, 'Klaviyo snapshot timed out, retrying…');
      await new Promise((r) => setTimeout(r, 2500));
      const retried = await invokeSnapshot();
      data = retried.data;
      fnErr = retried.error;
    }
  }
  if (fnErr) {
    const anyErr = fnErr as any;
    const status = anyErr?.context?.status ?? anyErr?.status ?? null;
    if (Number(status) === 401) {
      throw new Error('Klaviyo snapshot was rejected (401), usually an expired session. Refresh the page, sign in again, and retry.');
    }
    throw new Error(`Klaviyo snapshot failed: ${fnErr.message}`);
  }
  if (!data?.ok) throw new Error(data?.error?.message || 'Failed to fetch Klaviyo snapshot');

  progress(30, 'Stage 2/3: Pulling Klaviyo reporting (flow/campaign values)…');
  const reportingResult = await waitForReportingStage(auditId);
  if (reportingResult === 'error') progress(32, 'Reporting had errors (continuing with available data)…');
  else if (reportingResult === 'timed_out') progress(32, 'Reporting slow (Klaviyo rate-limited). Continuing…');

  const profilePending = (data as { profile_metrics_status?: string })?.profile_metrics_status === 'pending';
  let audienceWait: 'complete' | 'skipped' | 'timed_out' | 'none' = 'none';
  if (profilePending) {
    progress(35, 'Stage 3/3: Full Klaviyo profile scan…');
    audienceWait = await waitForProfileJobComplete(auditId, (totalProfiles) => {
      progress(
        35,
        totalProfiles > 0 ? `Stage 3/3: Scanning profiles… ${totalProfiles.toLocaleString()} scanned so far` : 'Stage 3/3: Full Klaviyo profile scan…',
      );
    });
    if (audienceWait === 'timed_out') progress(38, 'Audience scan still running in the background, continuing with AI…');
  }

  const dm = (data as { derived_metrics?: { list_size?: number; monthly_engagement?: number; revenue_per_recipient?: number | null } })?.derived_metrics;
  let snapshotListSize = Math.round(Number(dm?.list_size) || 0);
  let snapshotEngagement = Math.round(Number(dm?.monthly_engagement) || 0);
  let snapshotRpr =
    dm?.revenue_per_recipient != null && Number.isFinite(Number(dm.revenue_per_recipient))
      ? Math.round(Number(dm.revenue_per_recipient) * 100) / 100
      : 0;

  if (profilePending) {
    const { data: aud, error: audErr } = await supabase
      .from('audits')
      .select('list_size, monthly_traffic, aov')
      .eq('id', auditId)
      .single();
    if (audErr) throw audErr;
    if (aud) {
      snapshotListSize = Math.round(Number(aud.list_size) || 0);
      snapshotEngagement = Math.round(Number(aud.monthly_traffic) || 0);
      if (aud.aov != null && Number.isFinite(Number(aud.aov))) snapshotRpr = Math.round(Number(aud.aov) * 100) / 100;
    }
    if (audienceWait === 'timed_out') {
      const { data: jobPartial } = await supabase
        .from('klaviyo_profile_scan_jobs')
        .select('total_profiles, subscribed')
        .eq('audit_id', auditId)
        .maybeSingle();
      const tp = jobPartial?.total_profiles != null ? Number(jobPartial.total_profiles) : 0;
      const sub = jobPartial?.subscribed != null ? Number(jobPartial.subscribed) : 0;
      if (tp > 0) snapshotListSize = Math.round(tp);
      if (sub > 0) snapshotEngagement = Math.round(sub);
    }
  }

  if (snapshotListSize > 0 || snapshotEngagement > 0 || snapshotRpr > 0) {
    await updateAudit(auditId, {
      list_size: snapshotListSize,
      monthly_traffic: snapshotEngagement,
      aov: snapshotRpr,
    } as Partial<Audit>);
  }

  progress(40, 'Running AI analysis on server…');
  await waitForServerAuditAnalysis(auditId, {
    onUpdate: (label, p) => progress(Math.max(40, Math.min(95, p)), label),
  });
  progress(100, 'Done');
}

/** Run the web audit pipeline (Shopify fetch if connected, capture, analyze) for
 * an existing draft audit. Product/collection/cart pages are auto-detected by
 * the capture seed from the homepage. */
export async function runWebAudit(
  auditId: string,
  clientId: string,
  opts: { websiteUrl: string; onProgress?: RunProgress } = { websiteUrl: '' },
): Promise<void> {
  const progress = opts.onProgress ?? (() => {});

  // Shopify metrics (non-fatal; no-op if the client has no connection).
  progress(20, 'Fetching Shopify data (if connected)…');
  try {
    await supabase.functions.invoke<any>('web_fetch_snapshot', { body: { audit_id: auditId, client_id: clientId } });
  } catch { /* non-fatal */ }

  progress(45, 'Detecting key pages…');
  const pages: Record<string, string> = {};
  if (opts.websiteUrl.trim()) pages.homepage = opts.websiteUrl.trim();
  const { data: seedData, error: seedErr } = await supabase.functions.invoke<any>('web_capture_screenshots', {
    body: { action: 'seed', audit_id: auditId, client_id: clientId, pages },
  });
  if (seedErr) throw new Error(`Screenshot setup failed: ${seedErr.message}`);
  if (!seedData?.ok) throw new Error(seedData?.error?.message || 'Screenshot setup failed');
  const total = Number(seedData.total) || 0;

  progress(45, 'Capturing website screenshots (desktop & mobile)…');
  let remaining = total;
  // Extra headroom: rate-limited rows are requeued (up to ~4 retries each), so
  // allow several passes over the set rather than one shot per row.
  let safety = total * 3 + 12;
  while (remaining > 0 && safety-- > 0) {
    const { data: capData, error: capErr } = await supabase.functions.invoke<any>('web_capture_screenshots', {
      body: { action: 'capture_one', audit_id: auditId, client_id: clientId },
    });
    if (capErr || !capData?.ok) { await new Promise(r => setTimeout(r, 3500)); continue; }
    remaining = Number.isFinite(capData.remaining) ? Number(capData.remaining) : remaining;
    const done = Math.max(0, total - remaining);
    progress(Math.min(95, 45 + Math.round((done / Math.max(total, 1)) * 50)), `Capturing screenshots… ${done}/${total} done`);
    if (capData.done) break;
    await new Promise(r => setTimeout(r, 3500));
  }

  progress(97, 'Starting AI analysis…');
  try {
    await startWebAnalysis(auditId);
  } catch { /* non-fatal: workspace can resume/retry */ }
  progress(100, 'Done');
}
