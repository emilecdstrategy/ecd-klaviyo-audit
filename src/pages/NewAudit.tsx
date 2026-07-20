import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  Sparkles,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditWizardStepper from '../components/audit/AuditWizardStepper';
import ClientSearchSelect from '../components/audit/ClientSearchSelect';
import AuditContextAssistant from '../components/audit/AuditContextAssistant';
import type { AuditContextDraft } from '../lib/audit-context-agent';
import { useAuth } from '../contexts/AuthContext';
import { createAudit, createAuditSections, createClient, ensureClientCreator, findClientByCompanyName, listClients, updateAudit, updateClient, listRevenueOpportunityTemplates, uploadReportScreenshot } from '../lib/db';
import { resolveRevenueOpportunityContent } from '../lib/revenue-opportunity-content';
import { fetchTranscriptFromLink } from '../lib/transcript';
import type { Audit, AuditContext, AuditType, Client, RevenueOpportunityAddOnItem, RevenueOpportunityTemplate } from '../lib/types';
import { KLAVIYO_AUDIT_SECTION_KEYS, WEB_AUDIT_SECTION_KEYS } from '../lib/audit-sections';
import { IndustrySelectWithCustom } from '../components/ui/IndustrySelect';
import { KlaviyoApiKeyHelpTrigger } from '../components/klaviyo/KlaviyoApiKeyHelpModal';
import { ShopifyTokenHelpTrigger } from '../components/web/ShopifyTokenHelpModal';
import ImageUploadZone from '../components/ui/ImageUploadZone';
import { supabase } from '../lib/supabase';
import {
  clearAuditGenerationActive,
  markAuditGenerationActive,
  nudgeProfileScan,
  waitForServerAuditAnalysis,
} from '../lib/audit-pipeline-status';
import { startWebAnalysis } from '../lib/web-pipeline-status';

const CONTEXT_CHAR_SOFT = 15_000;
const CONTEXT_CHAR_HARD = 30_000;

type StepKey = 'type' | 'prospect' | 'klaviyo_connection' | 'web_setup' | 'attribution' | 'context' | 'run';

type WizardStep = { key: StepKey; label: string; description: string };

const KLAVIYO_STEPS: WizardStep[] = [
  { key: 'type', label: 'Audit Type', description: 'Klaviyo or Web' },
  { key: 'prospect', label: 'Prospect Details', description: 'Basic information' },
  { key: 'klaviyo_connection', label: 'API Connection', description: 'Connect Klaviyo data' },
  { key: 'attribution', label: 'Attribution Model', description: 'Optional screenshot' },
  { key: 'context', label: 'Client Context', description: 'Optional notes for the AI' },
  { key: 'run', label: 'Run Analysis', description: 'AI-powered audit' },
];

const WEB_STEPS: WizardStep[] = [
  { key: 'type', label: 'Audit Type', description: 'Klaviyo or Web' },
  { key: 'prospect', label: 'Prospect Details', description: 'Basic information' },
  { key: 'web_setup', label: 'Website', description: 'Pages and store access' },
  { key: 'context', label: 'Client Context', description: 'Optional notes' },
  { key: 'run', label: 'Run Analysis', description: 'Capture and analyze' },
];

type NewAuditProps = { asModal?: boolean };

async function invokeKlaviyoSnapshot(body: Record<string, unknown>) {
  // Refresh access token so the gateway (JWT verify) and Edge auth see a valid JWT.
  // Do not pass a custom Authorization header on invoke — that bypasses the client’s token refresh path.
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

/**
 * Poll klaviyo_runs for a stage-2 (reporting) row for the given audit. Stage 2
 * is chain-invoked from stage 1 with a fresh 150s budget, so wall time is
 * Klaviyo-bound (2/min steady reporting rate), not edge-timeout-bound. We keep
 * a generous cap while still nudging stage 2 if nothing has appeared.
 */
async function waitForReportingStage(
  auditId: string,
  onProgress?: (latest: KlaviyoRunRow | null) => void,
): Promise<'success' | 'partial' | 'error' | 'timed_out'> {
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
    onProgress?.(latest);
    if (latest?.status === 'success' || latest?.status === 'partial') return latest.status as any;
    if (latest?.status === 'error' || latest?.status === 'timeout') return 'error';
    // If no reporting row has been written after ~120s, kick stage 2 again.
    if (!latest && Date.now() - t0 > 120_000 && Date.now() - lastNudge > 90_000) {
      lastNudge = Date.now();
      invokeKlaviyoSnapshot({ stage: 'reporting', audit_id: auditId }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'timed_out';
}

/** Poll until profile job finishes. Large accounts can take hours across many Edge invocations. */
async function waitForProfileJobComplete(
  auditId: string,
  onProgress?: (totalProfiles: number) => void,
): Promise<'complete' | 'skipped' | 'timed_out'> {
  const maxMs = 4 * 60 * 60 * 1000; // 4 hours (was 45m; huge lists need many resume chunks)
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
    if (data.status === 'complete') {
      onProgress?.(data.total_profiles ?? 0);
      return 'complete';
    }
    if (data.status === 'skipped') {
      onProgress?.(data.total_profiles ?? 0);
      return 'skipped';
    }
    if (data.status === 'failed') {
      throw new Error(data.error_message || 'Audience metrics scan failed');
    }
    onProgress?.(data.total_profiles ?? 0);

    // Detect stalled scan and re-trigger the resume chain sooner
    if (data.updated_at === lastUpdated) {
      staleCount++;
    } else {
      staleCount = 0;
      lastUpdated = data.updated_at ?? '';
    }
    if (staleCount >= 3) {
      staleCount = 0;
      nudgeProfileScan(auditId).catch(() => {});
    }
    // Nudge resume periodically in case chain calls were dropped (large accounts)
    if (Date.now() - lastResumeAssist > 90_000) {
      lastResumeAssist = Date.now();
      nudgeProfileScan(auditId).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'timed_out';
}

function normalizeReportingDiagnostic(raw?: string | null, status?: number | null) {
  const msg = (raw ?? '').trim();
  if (!msg) return null;

  const lower = msg.toLowerCase();
  if (status === 429 || lower.includes('"code":"throttled"') || lower.includes('request was throttled') || lower.includes('throttle')) {
    const m = msg.match(/expected available in\s+(\d+)\s+seconds/i);
    const wait = m?.[1] ? ` (try again in ~${m[1]}s)` : '';
    return `Klaviyo rate-limited reporting requests${wait}. Re-run the audit shortly.`;
  }

  if (msg.length > 140) return `${msg.slice(0, 140)}…`;
  return msg;
}

export default function NewAudit({ asModal }: NewAuditProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [auditType, setAuditType] = useState<AuditType | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState<string>('');
  const [error, setError] = useState('');
  const [snapshotMeta, setSnapshotMeta] = useState<null | {
    counts?: Record<string, number | null>;
    reporting?: {
      flow_reports?: Array<{ timeframe: string; rows: number }>;
      campaign_reports?: Array<{ timeframe: string; rows: number }>;
      errors?: Array<{ stage: string; status?: number | null; message: string }>;
      reporting_ok?: boolean;
    };
    fetch?: any;
    elapsed_ms?: number;
    correlationId?: string;
  }>(null);
  const [stageRuns, setStageRuns] = useState<KlaviyoRunRow[]>([]);
  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    companyName: '',
    industry: '',
    apiKey: '',
    clientSellsSubscriptions: false,
    selectedAddOnSlugs: [] as string[],
    // Web audit fields
    websiteUrl: '',
    productUrl: '',
    collectionUrl: '',
    cartUrl: '',
    shopifyDomain: '',
    shopifyToken: '',
  });
  const [shopifyTest, setShopifyTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'failed'; message?: string }>({ status: 'idle' });

  const [auditContextForm, setAuditContextForm] = useState({
    meeting_notes: '',
    client_background: '',
    custom_instructions: '',
  });
  const [transcriptLink, setTranscriptLink] = useState('');
  const [transcriptFetching, setTranscriptFetching] = useState(false);
  const [transcriptMsg, setTranscriptMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [attributionScreenshot, setAttributionScreenshot] = useState<File | null>(null);
  const [attributionPreviewUrl, setAttributionPreviewUrl] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [revenueTemplates, setRevenueTemplates] = useState<RevenueOpportunityTemplate[]>([]);
  const selectedClient = form.clientId ? clients.find(c => c.id === form.clientId) : undefined;
  const hasSavedKlaviyoConnection = Boolean((selectedClient as any)?.klaviyo_connected);
  const hasSavedShopifyConnection = Boolean(selectedClient?.shopify_connected);

  const steps = auditType === 'web' ? WEB_STEPS : KLAVIYO_STEPS;
  const stepKey: StepKey = steps[Math.min(step, steps.length - 1)].key;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await listClients();
        if (!cancelled) setClients(c);
      } catch {
        // ignore; audit can still create new client
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const templates = await listRevenueOpportunityTemplates({ activeOnly: true });
        if (!cancelled) setRevenueTemplates(templates);
      } catch {
        if (!cancelled) setRevenueTemplates([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!attributionScreenshot) {
      setAttributionPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attributionScreenshot);
    setAttributionPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attributionScreenshot]);

  // If opened from a client detail, preselect that client.
  useEffect(() => {
    const st = location.state as any;
    const preClientId = (st?.clientId ?? '').toString();
    if (!preClientId) return;
    if (form.clientId) return;
    if (!clients.length) return; // wait until clients load
    handleClientSelect(preClientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, form.clientId, location.state]);

  const updateField = (field: string, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const updateContextField = (field: keyof typeof auditContextForm, value: string) => {
    const capped = value.length > CONTEXT_CHAR_HARD ? value.slice(0, CONTEXT_CHAR_HARD) : value;
    setAuditContextForm(prev => ({ ...prev, [field]: capped }));
  };

  const appendMeetingNotesFromFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.md') && file.type !== 'text/plain') {
      setError('Please upload a .txt or .md file, or paste notes directly.');
      return;
    }
    const text = await file.text();
    const block = `\n\n--- From file: ${file.name} ---\n${text}`;
    const next = (auditContextForm.meeting_notes + block).slice(0, CONTEXT_CHAR_HARD);
    setAuditContextForm(prev => ({ ...prev, meeting_notes: next }));
    setError('');
  };

  const fetchTranscriptLink = async () => {
    const url = transcriptLink.trim();
    if (!url || transcriptFetching) return;
    setTranscriptFetching(true);
    setTranscriptMsg(null);
    try {
      const res = await fetchTranscriptFromLink(url);
      if (!res.ok) {
        setTranscriptMsg({ type: 'error', text: res.message });
        return;
      }
      const existing = auditContextForm.meeting_notes.trim();
      const next = (existing ? `${existing}\n\n${res.content}` : res.content).slice(0, CONTEXT_CHAR_HARD);
      setAuditContextForm(prev => ({ ...prev, meeting_notes: next }));
      setTranscriptLink('');
      setTranscriptMsg({ type: 'ok', text: 'Transcript pulled in. Review it below.' });
    } finally {
      setTranscriptFetching(false);
    }
  };

  const applyContextDraft = (draft: AuditContextDraft) => {
    setAuditContextForm(prev => ({
      ...prev,
      client_background: (draft.client_background || prev.client_background).slice(0, CONTEXT_CHAR_HARD),
      custom_instructions: (draft.custom_instructions || prev.custom_instructions).slice(0, CONTEXT_CHAR_HARD),
    }));
    if (draft.sells_subscriptions) setForm(prev => ({ ...prev, clientSellsSubscriptions: true }));
  };

  function buildAuditContextForSave(): AuditContext | null {
    const meeting_notes = auditContextForm.meeting_notes.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    const client_background = auditContextForm.client_background.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    const custom_instructions = auditContextForm.custom_instructions.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    const sells_subscriptions = form.clientSellsSubscriptions || undefined;
    if (!meeting_notes && !client_background && !custom_instructions && !sells_subscriptions) return null;
    return { meeting_notes, client_background, custom_instructions, sells_subscriptions };
  }

  const handleClientSelect = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setForm(prev => ({
        ...prev,
        clientId,
        clientName: client.name,
        companyName: client.company_name,
        industry: client.industry ?? '',
        apiKey: '',
        websiteUrl: prev.websiteUrl || client.website_url || '',
        clientSellsSubscriptions: prev.clientSellsSubscriptions,
        selectedAddOnSlugs: prev.selectedAddOnSlugs,
      }));
    }
  };

  // If a client already has a saved Klaviyo connection, don't keep an API key in local state.
  useEffect(() => {
    if (hasSavedKlaviyoConnection && form.apiKey) {
      setForm(prev => ({ ...prev, apiKey: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSavedKlaviyoConnection]);

  // Poll recent klaviyo_runs (by audit_id) while analyzing so the "View run log" panel
  // shows all stages in real time — each stage gets its own correlation_id.
  const [currentAuditId, setCurrentAuditId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Guards against a double-submit (rapid double-click / re-entrancy) creating two audits.
  const submittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!analyzing || !currentAuditId) return;
    let cancelled = false;
    const tick = async () => {
      const { data } = await supabase
        .from('klaviyo_runs')
        .select('id, correlation_id, stage, status, elapsed_ms, error_code, error_message, created_at')
        .eq('audit_id', currentAuditId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!cancelled && data) setStageRuns(data as KlaviyoRunRow[]);
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [analyzing, currentAuditId]);

  const runAnalysis = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStage('Starting…');
    setSnapshotMeta(null);

    try {
      // 1) Ensure client exists
      setAnalysisStage('Preparing client…');
      let clientId = form.clientId;
      if (!clientId) {
        const existing = await findClientByCompanyName(form.companyName);
        if (existing) {
          clientId = existing.id;
        } else {
          const created = await createClient(await ensureClientCreator(user, {
            name: form.clientName || form.companyName,
            company_name: form.companyName,
            website_url: '',
            industry: form.industry,
            esp_platform: 'Klaviyo',
            api_key_placeholder: '',
            notes: '',
          }) as Partial<Client>);
          clientId = created.id;
        }
      } else {
        const patch: Record<string, string> = {};
        if (form.industry) patch.industry = form.industry;
        if (Object.keys(patch).length > 0) {
          const updated = await updateClient(clientId, patch);
          setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
        }
      }

      // 2) Create audit row
      setAnalysisStage('Creating audit…');
      const title = `${form.companyName} - Klaviyo Audit`;
      const contextPayload = buildAuditContextForSave();
      const selectedAddOnItems: RevenueOpportunityAddOnItem[] = revenueTemplates
        .filter(template => form.selectedAddOnSlugs.includes(template.slug))
        .map((template, index) => ({
          template_slug: template.slug,
          name: template.name,
          description: template.description || undefined,
          content: template.content || resolveRevenueOpportunityContent(template),
          bullets: [],
          revenue_monthly: 0,
          one_time_price: template.one_time_price ?? null,
          one_time_label: template.one_time_label ?? null,
          monthly_price: template.monthly_price ?? null,
          monthly_label: template.monthly_label ?? null,
          display_order: template.display_order ?? (index + 1) * 10,
          is_hidden: false,
          highlighted: false,
        }));
      const initialLayout: Record<string, unknown> = selectedAddOnItems.length > 0
        ? {
            revenue_summary: {
              blocks: {
                addOns: {
                  items: selectedAddOnItems,
                },
              },
            },
          }
        : {};
      const audit = await createAudit({
        client_id: clientId,
        title,
        status: 'draft',
        audit_method: 'api' as Audit['audit_method'],
        list_size: 0,
        aov: 0,
        monthly_traffic: 0,
        total_revenue_opportunity: 0,
        executive_summary: '',
        created_by: user?.id || '',
        show_recommendations: true,
        context: contextPayload,
        layout: Object.keys(initialLayout).length > 0 ? initialLayout : undefined,
      } as any);

      if (attributionScreenshot) {
        setAnalysisStage('Uploading attribution screenshot…');
        try {
          const url = await uploadReportScreenshot(attributionScreenshot, 'attribution');
          const layout = {
            ...(initialLayout as Record<string, unknown>),
            attribution_model: {
              sectionTitle: 'Attribution Model',
              screenshot_url: url,
            },
          };
          await updateAudit(audit.id, { layout });
        } catch {
          /* optional — audit can continue without screenshot */
        }
      }

      setCurrentAuditId(audit.id);
      markAuditGenerationActive(audit.id);
      setStageRuns([]);

      // 3) Create default section rows
      setAnalysisStage('Setting up audit sections…');
      await createAuditSections(audit.id, [...KLAVIYO_AUDIT_SECTION_KEYS]);

      // 4) Fetch Klaviyo snapshot (stage 1 = config; stages 2+ run on chained edge invocations)
      setAnalysisProgress(20);
      setAnalysisStage('Stage 1/3: Fetching Klaviyo config…');
      const snapshotPayload = {
        audit_id: audit.id,
        client_id: clientId,
        api_key: form.apiKey || undefined,
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
          setAnalysisStage('Klaviyo snapshot timed out, retrying…');
          await new Promise((r) => setTimeout(r, 2500));
          const retried = await invokeSnapshot();
          data = retried.data;
          fnErr = retried.error;
        }
      }
      if (fnErr) {
        const anyErr = fnErr as any;
        const status = anyErr?.context?.status ?? anyErr?.status ?? null;
        const body = anyErr?.context?.body ?? anyErr?.body ?? null;
        const bodyPreview =
          body && typeof body === 'object' && (body as any).getReader
            ? '[ReadableStream]'
            : body
              ? String(body).slice(0, 240)
              : null;
        const details = [
          status ? `status ${status}` : null,
          bodyPreview ? `body ${bodyPreview}` : null,
          import.meta.env.VITE_SUPABASE_URL ? `supabase ${String(import.meta.env.VITE_SUPABASE_URL)}` : null,
        ].filter(Boolean).join(' • ');
        if (Number(status) === 401) {
          throw new Error(
            'Klaviyo snapshot was rejected (401), usually an expired session. Refresh the page, sign in again, and retry.',
          );
        }
        throw new Error(`Klaviyo snapshot failed: ${fnErr.message}${details ? ` (${details})` : ''}`);
      }
      if (!data?.ok) throw new Error(data?.error?.message || 'Failed to fetch Klaviyo snapshot');
      setSnapshotMeta({
        counts: data?.counts,
        fetch: (data as any)?.fetch,
        reporting: data?.reporting,
        elapsed_ms: data?.elapsed_ms,
        correlationId: data?.correlationId,
      });

      // Stage 2 (reporting) runs asynchronously via edge function self-chain.
      // Poll klaviyo_runs(stage='reporting') until it lands so rollups + flow_performance are populated before AI.
      setAnalysisProgress(30);
      setAnalysisStage('Stage 2/3: Pulling Klaviyo reporting (flow/campaign values)…');
      const reportingResult = await waitForReportingStage(audit.id, (latest) => {
        if (latest) {
          setStageRuns((prev) => {
            if (prev.find((p) => p.id === latest.id)) return prev;
            return [latest, ...prev].slice(0, 10);
          });
        }
      });
      if (reportingResult === 'error') {
        // Reporting hit a hard failure. Surface it but keep going — AI can still analyze config-level data.
        setAnalysisStage('Reporting had errors (continuing with available data)…');
      } else if (reportingResult === 'timed_out') {
        setAnalysisStage('Reporting slow (Klaviyo rate-limited). Continuing with available data…');
      }

      // Refresh snapshot meta from the latest rollup so the UI and AI pick up stage-2 results.
      try {
        const { data: rollup } = await supabase
          .from('klaviyo_reporting_rollups')
          .select('computed')
          .eq('audit_id', audit.id)
          .eq('timeframe_key', 'last_30_days')
          .maybeSingle();
        const computed = (rollup?.computed ?? {}) as any;
        setSnapshotMeta((prev) => ({
          ...(prev ?? {}),
          counts: computed?.counts ?? prev?.counts,
          reporting: {
            ...(prev?.reporting ?? {}),
            errors: computed?.reporting_errors ?? prev?.reporting?.errors,
            reporting_ok: (computed?.reporting_errors?.length ?? 0) === 0,
          },
        }));
      } catch { /* non-critical */ }

      const profilePending = (data as { profile_metrics_status?: string })?.profile_metrics_status === 'pending';
      let audienceWait: 'complete' | 'skipped' | 'timed_out' | 'none' = 'none';
      if (profilePending) {
        setAnalysisProgress(35);
        setAnalysisStage('Stage 3/3: Full Klaviyo profile scan…');
        audienceWait = await waitForProfileJobComplete(audit.id, (totalProfiles) => {
          setAnalysisStage(
            totalProfiles > 0
              ? `Stage 3/3: Scanning profiles… ${totalProfiles.toLocaleString()} scanned so far`
              : 'Stage 3/3: Full Klaviyo profile scan…',
          );
        });
        if (audienceWait === 'timed_out') {
          setAnalysisStage('Audience scan still running in the background — continuing with AI…');
        }
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
          .eq('id', audit.id)
          .single();
        if (audErr) throw audErr;
        if (aud) {
          snapshotListSize = Math.round(Number(aud.list_size) || 0);
          snapshotEngagement = Math.round(Number(aud.monthly_traffic) || 0);
          if (aud.aov != null && Number.isFinite(Number(aud.aov))) {
            snapshotRpr = Math.round(Number(aud.aov) * 100) / 100;
          }
        }
        if (audienceWait === 'timed_out') {
          const { data: jobPartial } = await supabase
            .from('klaviyo_profile_scan_jobs')
            .select('total_profiles, subscribed')
            .eq('audit_id', audit.id)
            .maybeSingle();
          const tp = jobPartial?.total_profiles != null ? Number(jobPartial.total_profiles) : 0;
          const sub = jobPartial?.subscribed != null ? Number(jobPartial.subscribed) : 0;
          if (tp > 0) snapshotListSize = Math.round(tp);
          if (sub > 0) snapshotEngagement = Math.round(sub);
        }
      }

      if (snapshotListSize > 0 || snapshotEngagement > 0 || snapshotRpr > 0) {
        await updateAudit(audit.id, {
          list_size: snapshotListSize,
          monthly_traffic: snapshotEngagement,
          aov: snapshotRpr,
        } as Partial<Audit>);
      }

      setAnalysisProgress(40);
      setAnalysisStage('Running AI analysis on server…');
      await waitForServerAuditAnalysis(audit.id, {
        onUpdate: (label, progress) => {
          setAnalysisStage(label);
          setAnalysisProgress(Math.max(40, Math.min(95, progress)));
        },
      });

      setAnalysisProgress(100);
      setAnalysisStage('Done');
      setAnalyzing(false);
      clearAuditGenerationActive(audit.id);
      if (mountedRef.current) navigate(`/audits/${audit.id}`);
    } catch (e: unknown) {
      setAnalyzing(false);
      submittingRef.current = false;
      setError(e instanceof Error ? e.message : 'Failed to run analysis');
    }
  };

  const testShopifyConnection = async () => {
    setShopifyTest({ status: 'testing' });
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<any>('shopify_test_connection', {
        body: { shopDomain: form.shopifyDomain, accessToken: form.shopifyToken },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (!data?.ok) {
        setShopifyTest({ status: 'failed', message: data?.error?.message || data?.error || 'Connection failed' });
        return;
      }
      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      setShopifyTest({
        status: 'ok',
        message: warnings.length > 0
          ? `Connected to ${data.shop?.name ?? form.shopifyDomain}, but: ${warnings.join(' ')}`
          : `Connected to ${data.shop?.name ?? form.shopifyDomain}.`,
      });
    } catch (e) {
      setShopifyTest({ status: 'failed', message: e instanceof Error ? e.message : 'Connection failed' });
    }
  };

  const runAnalysisWeb = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStage('Starting…');

    try {
      // 1) Ensure client exists
      setAnalysisStage('Preparing client…');
      let clientId = form.clientId;
      if (!clientId) {
        const existing = await findClientByCompanyName(form.companyName);
        if (existing) {
          clientId = existing.id;
        } else {
          const created = await createClient(await ensureClientCreator(user, {
            name: form.clientName || form.companyName,
            company_name: form.companyName,
            website_url: form.websiteUrl.trim(),
            industry: form.industry,
            esp_platform: 'Shopify',
            api_key_placeholder: '',
            notes: '',
          }) as Partial<Client>);
          clientId = created.id;
        }
      } else {
        const patch: Record<string, string> = {};
        if (form.industry) patch.industry = form.industry;
        if (form.websiteUrl.trim() && !selectedClient?.website_url) patch.website_url = form.websiteUrl.trim();
        if (Object.keys(patch).length > 0) {
          const updated = await updateClient(clientId, patch);
          setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
        }
      }

      // 2) Create audit row
      setAnalysisStage('Creating audit…');
      const contextPayload = buildAuditContextForSave();
      const audit = await createAudit({
        client_id: clientId,
        title: `${form.companyName} - Web Audit`,
        status: 'draft',
        audit_type: 'web',
        audit_method: 'screenshot' as Audit['audit_method'],
        list_size: 0,
        aov: 0,
        monthly_traffic: 0,
        total_revenue_opportunity: 0,
        executive_summary: '',
        created_by: user?.id || '',
        show_recommendations: true,
        context: contextPayload,
      } as any);
      setCurrentAuditId(audit.id);
      setAnalysisProgress(10);

      // 3) Seed web section rows
      setAnalysisStage('Setting up audit sections…');
      await createAuditSections(audit.id, [...WEB_AUDIT_SECTION_KEYS]);

      // 4) Connect Shopify + fetch backend metrics (optional)
      if (!hasSavedShopifyConnection && form.shopifyToken.trim()) {
        setAnalysisProgress(20);
        setAnalysisStage('Connecting Shopify…');
        const { data: connData, error: connErr } = await supabase.functions.invoke<any>('shopify_connect_client', {
          body: { client_id: clientId, shop_domain: form.shopifyDomain, access_token: form.shopifyToken },
        });
        if (connErr) throw new Error(`Shopify connection failed: ${connErr.message}`);
        if (!connData?.ok) throw new Error(connData?.error?.message || 'Shopify connection failed');
      }
      if (hasSavedShopifyConnection || form.shopifyToken.trim()) {
        setAnalysisProgress(30);
        setAnalysisStage('Fetching Shopify data (orders, products)…');
        const { data: fetchData, error: fetchErr } = await supabase.functions.invoke<any>('web_fetch_snapshot', {
          body: { audit_id: audit.id, client_id: clientId },
        });
        if (fetchErr || !fetchData?.ok) {
          // Non-fatal: continue with screenshots only.
          setAnalysisStage('Shopify data fetch had issues, continuing with screenshots…');
        }
      }

      // 5) Seed capture targets. The edge function auto-detects the product,
      //    collection, and cart pages (from Shopify or the homepage HTML) when
      //    they aren't supplied manually.
      setAnalysisProgress(45);
      setAnalysisStage('Detecting key pages…');
      const pages: Record<string, string> = { homepage: form.websiteUrl.trim() };
      if (form.productUrl.trim()) pages.product = form.productUrl.trim();
      if (form.collectionUrl.trim()) pages.collection = form.collectionUrl.trim();
      if (form.cartUrl.trim()) pages.cart = form.cartUrl.trim();
      const { data: seedData, error: seedErr } = await supabase.functions.invoke<any>('web_capture_screenshots', {
        body: { action: 'seed', audit_id: audit.id, client_id: clientId, pages },
      });
      if (seedErr) throw new Error(`Screenshot setup failed: ${seedErr.message}`);
      if (!seedData?.ok) throw new Error(seedData?.error?.message || 'Screenshot setup failed');
      const total = Number(seedData.total) || 0;

      // 6) Capture one screenshot per call, browser-driven. Keeping each edge
      //    invocation short (a single Playwright shot) avoids the platform
      //    rate limiter that a long self-chaining function tripped.
      setAnalysisStage('Capturing website screenshots (desktop & mobile)…');
      let remaining = total;
      let safety = total + 6;
      while (remaining > 0 && safety-- > 0) {
        const { data: capData, error: capErr } = await supabase.functions.invoke<any>('web_capture_screenshots', {
          body: { action: 'capture_one', audit_id: audit.id, client_id: clientId },
        });
        if (capErr || !capData?.ok) {
          await new Promise(r => setTimeout(r, 2500));
          continue;
        }
        remaining = Number.isFinite(capData.remaining) ? Number(capData.remaining) : remaining;
        const done = Math.max(0, total - remaining);
        setAnalysisProgress(Math.min(95, 45 + Math.round((done / Math.max(total, 1)) * 50)));
        setAnalysisStage(`Capturing screenshots… ${done}/${total} done`);
        if (capData.done) break;
        // Pause between captures so neither the Supabase gateway nor the target
        // store throttles the back-to-back requests.
        await new Promise(r => setTimeout(r, 2500));
      }

      // 7) Kick off AI analysis (runs on the server); the workspace shows progress.
      setAnalysisProgress(97);
      setAnalysisStage('Starting AI analysis…');
      try {
        await startWebAnalysis(audit.id);
      } catch {
        // Non-fatal: the workspace can resume/retry the analysis.
      }

      setAnalysisProgress(100);
      setAnalysisStage('Done');
      setAnalyzing(false);
      if (mountedRef.current) navigate(`/audits/${audit.id}`);
    } catch (e: unknown) {
      setAnalyzing(false);
      submittingRef.current = false;
      setError(e instanceof Error ? e.message : 'Failed to create web audit');
    }
  };

  const canProceed = () => {
    if (stepKey === 'type') return auditType !== null;
    if (stepKey === 'prospect') return form.companyName;
    if (stepKey === 'klaviyo_connection') return hasSavedKlaviyoConnection || form.apiKey;
    if (stepKey === 'web_setup') {
      const hasWebsite = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(form.websiteUrl.trim());
      const shopifyPartial = !hasSavedShopifyConnection && (form.shopifyDomain.trim() !== '') !== (form.shopifyToken.trim() !== '');
      return hasWebsite && !shopifyPartial;
    }
    return true;
  };

  const body = (
    <div className={asModal ? 'p-5' : 'p-8 max-w-4xl'}>
      <style>{``}</style>
      {!asModal && (
        <button
          onClick={() => step > 0 ? setStep(step - 1) : navigate('/')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {step > 0 ? 'Previous Step' : 'Back to Dashboard'}
        </button>
      )}

        <div className="bg-white rounded-xl p-6 card-shadow mb-8">
          <AuditWizardStepper steps={steps} currentStep={step} />
        </div>

        {stepKey === 'type' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up mx-auto w-full max-w-2xl">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">What kind of audit is this?</h2>
              <p className="text-sm text-gray-500 mt-1">The wizard adapts to the audit type you pick.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => { setAuditType('klaviyo'); setError(''); setStep(1); }}
                className={`text-left rounded-xl border-2 p-5 transition-colors ${
                  auditType === 'klaviyo'
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${auditType === 'klaviyo' ? 'gradient-bg' : 'bg-gray-100'}`}>
                  <Mail className={`w-5 h-5 ${auditType === 'klaviyo' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <p className="text-sm font-semibold text-gray-900">Klaviyo Audit</p>
                <p className="text-xs text-gray-500 mt-1">
                  Email marketing audit from live Klaviyo data: flows, campaigns, segments, forms, and deliverability.
                </p>
              </button>
              <button
                type="button"
                onClick={() => { setAuditType('web'); setError(''); setStep(1); }}
                className={`text-left rounded-xl border-2 p-5 transition-colors ${
                  auditType === 'web'
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${auditType === 'web' ? 'gradient-bg' : 'bg-gray-100'}`}>
                  <Globe className={`w-5 h-5 ${auditType === 'web' ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <p className="text-sm font-semibold text-gray-900">Web Audit</p>
                <p className="text-xs text-gray-500 mt-1">
                  Website audit with desktop and mobile screenshots of key pages, plus optional Shopify backend metrics.
                </p>
              </button>
            </div>
          </div>
        )}

        {stepKey === 'prospect' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up mx-auto w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900">Prospect Details</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Existing Client</label>
              <ClientSearchSelect
                clients={clients}
                value={form.clientId}
                onSelect={handleClientSelect}
                onClear={() => setForm(prev => ({ ...prev, clientId: '' }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={e => updateField('companyName', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="Acme Co."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={form.clientName}
                  onChange={e => updateField('clientName', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="John Doe"
                />
              </div>
            </div>

              <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <IndustrySelectWithCustom value={form.industry} onValueChange={v => updateField('industry', v)} />
            </div>

            {auditType !== 'web' && (
            <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/60">
              <div className="min-w-0 pr-2">
                <p className="text-sm font-medium text-gray-800">Client sells subscriptions</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  If enabled, the Flows audit also evaluates a Subscription lifecycle flow using soft matching on flow names.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.clientSellsSubscriptions}
                onClick={() => setForm(prev => ({ ...prev, clientSellsSubscriptions: !prev.clientSellsSubscriptions }))}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${form.clientSellsSubscriptions ? 'bg-brand-primary' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${form.clientSellsSubscriptions ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            )}
          </div>
        )}

        {stepKey === 'web_setup' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-6 animate-slide-up mx-auto w-full max-w-2xl">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Website</h2>
              <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                We capture desktop and mobile screenshots of the pages below. Product, collection, and cart URLs are optional but recommended.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Website URL (homepage)</label>
                <input
                  type="url"
                  value={form.websiteUrl}
                  onChange={e => updateField('websiteUrl', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="https://store.com"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  We'll automatically detect and screenshot the product, collection, and cart pages. Override them below if needed.
                </p>
              </div>

              <details className="group border border-gray-200 rounded-lg">
                <summary className="cursor-pointer list-none flex items-center justify-between px-3.5 py-2.5 text-sm font-medium text-gray-800 [&::-webkit-details-marker]:hidden">
                  <span>Override detected pages</span>
                  <span className="text-xs text-gray-400 font-normal">Optional</span>
                </summary>
                <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-gray-100">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Product page URL</label>
                    <input
                      type="url"
                      value={form.productUrl}
                      onChange={e => updateField('productUrl', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      placeholder="https://store.com/products/…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Collection page URL</label>
                    <input
                      type="url"
                      value={form.collectionUrl}
                      onChange={e => updateField('collectionUrl', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      placeholder="https://store.com/collections/…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cart URL</label>
                    <input
                      type="url"
                      value={form.cartUrl}
                      onChange={e => updateField('cartUrl', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      placeholder="Leave blank to capture the slide-cart drawer"
                    />
                  </div>
                </div>
              </details>
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Shopify backend metrics</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Optional. Connect the store's Admin API to pull orders, AOV, and revenue for the audit.
                  </p>
                </div>
                <ShopifyTokenHelpTrigger className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand-primary transition-colors hover:text-brand-primary-dark hover:underline" />
              </div>
              {hasSavedShopifyConnection ? (
                <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 px-4 py-3 rounded-lg">
                  This client is already connected to Shopify. We'll use the saved connection automatically.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Store domain</label>
                      <input
                        type="text"
                        value={form.shopifyDomain}
                        onChange={e => { updateField('shopifyDomain', e.target.value); setShopifyTest({ status: 'idle' }); }}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        placeholder="my-store.myshopify.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Admin API access token</label>
                      <input
                        type="password"
                        value={form.shopifyToken}
                        onChange={e => { updateField('shopifyToken', e.target.value); setShopifyTest({ status: 'idle' }); }}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={!form.shopifyDomain.trim() || !form.shopifyToken.trim() || shopifyTest.status === 'testing'}
                      onClick={testShopifyConnection}
                      className="text-sm font-medium text-brand-primary hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      {shopifyTest.status === 'testing' ? 'Testing…' : 'Test connection'}
                    </button>
                    {shopifyTest.status === 'ok' && (
                      <span className="text-xs text-emerald-700">{shopifyTest.message}</span>
                    )}
                    {shopifyTest.status === 'failed' && (
                      <span className="text-xs text-red-600">{shopifyTest.message}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {stepKey === 'klaviyo_connection' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up mx-auto w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900">API Connection</h2>
            {hasSavedKlaviyoConnection ? (
              <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 px-4 py-3 rounded-lg">
                This client is already connected to Klaviyo. We’ll use the saved connection automatically.
              </div>
            ) : (
            <div>
                <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="block text-sm font-medium text-gray-700">Klaviyo Private API Key</label>
                  <KlaviyoApiKeyHelpTrigger className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand-primary transition-colors hover:text-brand-primary-dark hover:underline" />
                </div>
              <input
                type="password"
                value={form.apiKey}
                onChange={e => updateField('apiKey', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                placeholder="pk_xxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            )}
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
              <p className="font-medium mb-1">What we'll fetch:</p>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>Account overview and key metrics</li>
                <li>Active flows and their performance</li>
                <li>Recent campaign data</li>
                <li>Segments and list information</li>
                <li>Form performance data</li>
              </ul>
            </div>
          </div>
        )}

        {stepKey === 'attribution' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Attribution Model</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                  Optional. Upload a screenshot of the client&apos;s Klaviyo attribution settings. It will appear as a dedicated section in the report.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setError(''); setStep(step + 1); }}
                className="text-sm text-brand-primary font-medium hover:underline whitespace-nowrap"
              >
                Skip this step
              </button>
            </div>
            <ImageUploadZone
              previewUrl={attributionPreviewUrl}
              previewAlt="Attribution model screenshot preview"
              label="Add attribution screenshot"
              onFile={file => setAttributionScreenshot(file)}
              onRemove={
                attributionScreenshot
                  ? () => setAttributionScreenshot(null)
                  : undefined
              }
            />
          </div>
        )}

        {stepKey === 'context' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-6 animate-slide-up mx-auto w-full max-w-2xl">
            {error ? (
              <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
            ) : null}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Client Context</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                  Optional. Paste a Fireflies link and we'll pull the transcript in automatically, or add notes yourself. Add what the client cares about so the report matches their conversation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setError(''); setStep(step + 1); }}
                className="text-sm text-brand-primary font-medium hover:underline whitespace-nowrap"
              >
                Skip this step
              </button>
            </div>

            <AuditContextAssistant
              onApply={applyContextDraft}
              getSnapshot={() => ({
                client_name: form.clientName,
                company_name: form.companyName,
                website_url: form.websiteUrl,
                audit_type: auditType ?? undefined,
                meeting_notes: auditContextForm.meeting_notes,
                client_background: auditContextForm.client_background,
                custom_instructions: auditContextForm.custom_instructions,
              })}
            />

            <details className="group border border-gray-200 rounded-lg open:ring-1 open:ring-brand-primary/15" open>
              <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 font-medium text-gray-900 bg-gray-50/80 rounded-lg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
                <span>Meeting notes & transcripts</span>
                <span className="text-xs text-gray-500 font-normal">Fireflies, Fathom, etc.</span>
              </summary>
              <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-2">
                {/* Fireflies link → auto-fetch the transcript (reuses the same
                    Fireflies integration as Proposals and Documents). */}
                <label className="block text-xs font-medium text-gray-600">Paste a Fireflies link</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="url"
                    value={transcriptLink}
                    onChange={e => { setTranscriptLink(e.target.value); setTranscriptMsg(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void fetchTranscriptLink(); } }}
                    placeholder="https://app.fireflies.ai/view/…"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => void fetchTranscriptLink()}
                    disabled={!transcriptLink.trim() || transcriptFetching}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50"
                  >
                    {transcriptFetching ? <><Loader2 className="h-4 w-4 animate-spin" /> Fetching…</> : 'Fetch transcript'}
                  </button>
                </div>
                {transcriptMsg && (
                  <p className={`text-xs ${transcriptMsg.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>{transcriptMsg.text}</p>
                )}
                <p className="text-[11px] text-gray-400">A Google Doc share link works too. Or paste notes manually below.</p>

                <label className="block pt-1 text-xs font-medium text-gray-600">Notes or transcript</label>
                <textarea
                  value={auditContextForm.meeting_notes}
                  onChange={e => updateContextField('meeting_notes', e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-y min-h-[120px]"
                  placeholder="Paste call summary, transcript, or key quotes…"
                />
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span>
                    {auditContextForm.meeting_notes.length.toLocaleString()} / {CONTEXT_CHAR_HARD.toLocaleString()} characters
                    {auditContextForm.meeting_notes.length > CONTEXT_CHAR_SOFT && (
                      <span className="text-amber-600 ml-1">(large; consider trimming)</span>
                    )}
                  </span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-brand-primary font-medium">
                    <input
                      type="file"
                      accept=".txt,.md,text/plain"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) await appendMeetingNotesFromFile(f);
                      }}
                    />
                    Upload .txt / .md
                  </label>
                </div>
              </div>
            </details>

            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 font-medium text-gray-900 bg-gray-50/80 rounded-lg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
                <span>Client background</span>
                <span className="text-xs text-gray-500 font-normal">Goals, pain points</span>
              </summary>
              <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                <textarea
                  value={auditContextForm.client_background}
                  onChange={e => updateContextField('client_background', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-y"
                  placeholder="e.g. Launching a new line in Q2, focused on VIP retention, deliverability concerns…"
                />
              </div>
            </details>

            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 font-medium text-gray-900 bg-gray-50/80 rounded-lg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
                <span>Custom instructions for the audit</span>
                <span className="text-xs text-gray-500 font-normal">Focus areas</span>
              </summary>
              <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                <textarea
                  value={auditContextForm.custom_instructions}
                  onChange={e => updateContextField('custom_instructions', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-y"
                  placeholder="e.g. Deep dive on abandoned cart, they asked about SMS…"
                />
              </div>
            </details>

            {revenueTemplates.length > 0 && (
              <details className="group border border-gray-200 rounded-lg" open>
                <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 font-medium text-gray-900 bg-gray-50/80 rounded-lg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
                  <span>Predefined Line Items</span>
                  <span className="text-xs text-gray-500 font-normal">Optional report add-ons</span>
                </summary>
                <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-2">
                  <p className="text-xs text-gray-500">
                    Select opportunities to include in this report. You can edit their copy and monthly value later in the Line Item Catalog.
                  </p>
                  <div className="space-y-2">
                    {revenueTemplates.map(template => {
                      const checked = form.selectedAddOnSlugs.includes(template.slug);
                      return (
                        <div
                          key={template.id}
                          className={`rounded-lg border px-3 py-2.5 transition-colors ${
                            checked
                              ? 'border-brand-primary/30 bg-brand-primary/5'
                              : 'border-gray-100 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 pr-2">
                              <p className="text-sm font-medium text-gray-800">{template.name}</p>
                              {template.description && (
                                <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={checked}
                                onClick={() => {
                                  setForm(prev => {
                                    const current = prev.selectedAddOnSlugs;
                                    const next = checked
                                      ? current.filter(slug => slug !== template.slug)
                                      : [...current, template.slug];
                                    return {
                                      ...prev,
                                      selectedAddOnSlugs: next,
                                    };
                                  });
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-brand-primary' : 'bg-gray-200'}`}
                              >
                                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {stepKey === 'run' && (
          <div className="bg-white rounded-xl p-8 card-shadow text-center animate-slide-up">
            {error && (
              <div className="mb-4 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg text-left">
                {error}
              </div>
            )}
            {!analyzing ? (
              <>
                <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {auditType === 'web' ? 'Ready to Capture' : 'Ready to Analyze'}
                </h2>
                <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
                  {auditType === 'web'
                    ? "We'll capture desktop and mobile screenshots of the selected pages and pull Shopify metrics if connected. You'll be able to review everything before publishing."
                    : "Our AI will review the collected data and generate detailed findings for each audit section. You'll be able to review and edit everything before publishing."}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => { setError(''); setStep(step - 1); }}
                    className="inline-flex items-center gap-2 px-4 py-3 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={auditType === 'web' ? runAnalysisWeb : runAnalysis}
                    className="inline-flex items-center gap-2 px-6 py-3 gradient-bg text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Sparkles className="w-4 h-4" />
                    {auditType === 'web' ? 'Create Web Audit' : 'Run AI Analysis'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Loader2 className="w-12 h-12 text-brand-primary animate-spin mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {auditType === 'web' ? 'Building Web Audit...' : 'Analyzing Account...'}
                </h2>
                <p className="text-sm text-gray-500 mb-2">
                  {analysisStage || 'Generating findings across all audit sections.'}
                </p>
                <p className="text-xs text-gray-400 mb-6 max-w-md mx-auto">
                  Analysis continues on the server — you can safely close this tab and reopen the audit from the Audits page anytime.
                </p>
                <div className="max-w-xs mx-auto">
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full gradient-bg rounded-full transition-all duration-500"
                      style={{ width: `${analysisProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{analysisProgress}% complete</p>
                </div>
                <div className="max-w-md mx-auto mt-5 text-left">
                  {[
                    {
                      key: 'create',
                      label: 'Create audit',
                      done: analysisProgress >= 10,
                      active: analysisProgress < 10,
                    },
                    {
                      key: 'input',
                      label: auditType === 'web' ? 'Fetch Shopify data' : 'Fetch Klaviyo snapshot',
                      done: analysisProgress >= 40,
                      active: analysisProgress >= 10 && analysisProgress < 40,
                    },
                    {
                      key: 'ai',
                      label: auditType === 'web' ? 'Capture screenshots' : 'Run AI analysis',
                      done: analysisProgress >= 70,
                      active: analysisProgress >= 40 && analysisProgress < 70,
                    },
                    {
                      key: 'save',
                      label: 'Save results',
                      done: analysisProgress >= 100,
                      active: analysisProgress >= 70 && analysisProgress < 100,
                    },
                  ].map((s) => (
                    <div
                      key={s.key}
                      className={[
                        'flex items-center gap-2 text-sm rounded-md px-2 py-1 transition-colors',
                        s.done ? 'text-gray-900' : 'text-gray-600',
                        s.active ? 'bg-gray-50' : '',
                      ].join(' ')}
                    >
                      <div className="relative">
                        <CheckCircle2 className={s.done ? 'w-4 h-4 text-green-600' : s.active ? 'w-4 h-4 text-brand-primary' : 'w-4 h-4 text-gray-300'} />
                        {s.active && (
                          <span className="absolute inset-0 rounded-full blur-[6px] bg-brand-primary/25 animate-pulse" />
                        )}
                      </div>
                      <span className={s.active ? 'font-medium text-brand-primary animate-pulse [text-shadow:0_0_18px_rgba(99,102,241,0.35)]' : ''}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
                {snapshotMeta?.counts && (() => {
                  const fetch = snapshotMeta.fetch as Record<string, { ok: boolean; status?: number | null }> | undefined;
                  const resources = ['flows', 'campaigns', 'segments', 'forms', 'lists'] as const;
                  const failedFetches = fetch ? resources.filter(r => fetch[r] && !fetch[r].ok) : [];
                  const failedScopes = failedFetches.filter(r => {
                    const status = fetch?.[r]?.status ?? null;
                    return status === 401 || status === 403;
                  });
                  const failedOther = failedFetches.filter(r => !failedScopes.includes(r));
                  return (
                    <div className="max-w-md mx-auto mt-4 text-left bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Klaviyo data pulled</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                        {resources.filter(r => r !== 'lists').map(r => {
                          const diag = fetch?.[r];
                          const ok = diag ? diag.ok : true;
                          const count = snapshotMeta.counts?.[r];
                          const failLabel =
                            ok === false
                              ? (diag?.status === 401 || diag?.status === 403 ? 'No access' : 'Fetch failed')
                              : '';
                          return (
                            <div key={r} className="flex items-center justify-between">
                              <span className="capitalize">{r}</span>
                              {ok === false ? (
                                <span className="font-medium text-amber-600">{failLabel}</span>
                              ) : (
                                <span className="font-medium text-gray-900">{count ?? '—'}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {failedScopes.length > 0 && (
                        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1.5 rounded">
                          Your API key is missing permissions for: <strong>{failedScopes.join(', ')}</strong>.
                          Regenerate the key in Klaviyo with full read access for complete data.
                        </div>
                      )}
                      {failedOther.length > 0 && (
                        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1.5 rounded">
                          Could not pull: <strong>{failedOther.join(', ')}</strong>. This is usually a temporary Klaviyo API issue — retry the audit or contact support if it persists.
                        </div>
                      )}
                      {Array.isArray(snapshotMeta.reporting?.errors) && snapshotMeta.reporting!.errors!.length > 0 && (
                        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1.5 rounded space-y-1">
                          <p className="font-semibold">Reporting metrics could not be fully pulled.</p>
                          {snapshotMeta.reporting!.errors!.slice(0, 3).map((e, idx) => (
                            <p key={`${e.stage}-${idx}`}>
                              {(() => {
                                const friendly = normalizeReportingDiagnostic(e.message, e.status ?? null);
                                return (
                                  <>
                              <span className="font-medium">{e.stage}</span>
                              {e.status ? ` (${e.status})` : ''}: {friendly ?? 'Reporting request failed'}
                                  </>
                                );
                              })()}
                            </p>
                          ))}
                          <p>Flow KPI cards may show N/A until reporting access succeeds.</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {stageRuns.length > 0 && (
                  <details className="max-w-md mx-auto mt-3 text-left border border-gray-100 rounded-lg bg-gray-50/60">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider list-none flex items-center justify-between [&::-webkit-details-marker]:hidden">
                      <span>Run log ({stageRuns.length})</span>
                      <span className="text-[10px] text-gray-400 normal-case tracking-normal">audit_id {currentAuditId?.slice(0, 8)}</span>
                    </summary>
                    <div className="px-3 pb-3 space-y-1.5">
                      {stageRuns.map((r) => {
                        const badge =
                          r.status === 'success' ? 'bg-emerald-100 text-emerald-700'
                          : r.status === 'partial' ? 'bg-amber-100 text-amber-700'
                          : r.status === 'timeout' ? 'bg-orange-100 text-orange-700'
                          : 'bg-red-100 text-red-700';
                        return (
                          <div key={r.id} className="flex items-start justify-between gap-2 text-[11px] text-gray-700">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`px-1.5 py-0.5 rounded ${badge} font-medium`}>
                                  {r.stage ?? 'unknown'}
                                </span>
                                <span className="text-gray-500">{r.status}</span>
                                {r.elapsed_ms != null && (
                                  <span className="text-gray-400">· {(r.elapsed_ms / 1000).toFixed(1)}s</span>
                                )}
                              </div>
                              {r.error_message && (
                                <p className="text-[10px] text-gray-500 mt-0.5 break-words">{r.error_message.slice(0, 200)}</p>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">
                              {new Date(r.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {stepKey !== 'run' && (
          <div className="flex items-center mt-6 mx-auto w-full max-w-2xl">
            {step > 0 ? (
              <button
                onClick={() => { setError(''); setStep(step - 1); }}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            ) : <span />}
            <button
              onClick={() => {
                if (stepKey === 'context') setError('');
                setStep(step + 1);
              }}
              disabled={!canProceed()}
              className="ml-auto flex items-center gap-2 px-6 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
  );

  if (asModal) return body;

  return (
    <div>
      <TopBar title="New Audit" subtitle="Create a new audit" />
      <div className="animate-fade-in">{body}</div>
    </div>
  );
}
