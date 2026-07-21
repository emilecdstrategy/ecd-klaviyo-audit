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

const CONTEXT_CHAR_HARD = 30_000;

type StepKey = 'type' | 'prospect' | 'klaviyo_connection' | 'web_setup' | 'attribution' | 'line_items';

type WizardStep = { key: StepKey; label: string; description: string };

// The wizard now only gathers setup data and creates a DRAFT audit; the client
// context (AI-assisted) and the actual run happen in the audit workspace.
const KLAVIYO_STEPS: WizardStep[] = [
  { key: 'type', label: 'Audit Type', description: 'Klaviyo or Web' },
  { key: 'prospect', label: 'Prospect Details', description: 'Basic information' },
  { key: 'klaviyo_connection', label: 'API Connection', description: 'Connect Klaviyo data' },
  { key: 'attribution', label: 'Attribution Model', description: 'Optional screenshot' },
  { key: 'line_items', label: 'Line Items', description: 'Optional add-ons' },
];

const WEB_STEPS: WizardStep[] = [
  { key: 'type', label: 'Audit Type', description: 'Klaviyo or Web' },
  { key: 'prospect', label: 'Prospect Details', description: 'Basic information' },
  { key: 'web_setup', label: 'Website', description: 'Pages and store access' },
  { key: 'line_items', label: 'Line Items', description: 'Optional add-ons' },
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

  // Create a DRAFT audit (client + audit row + sections + persisted connections)
  // and open its workspace. Context and the actual run happen there.
  const createDraftKlaviyo = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setAnalyzing(true);
    try {
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
      } else if (form.industry) {
        const updated = await updateClient(clientId, { industry: form.industry });
        setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      }

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
        ? { revenue_summary: { blocks: { addOns: { items: selectedAddOnItems } } } }
        : {};
      const audit = await createAudit({
        client_id: clientId,
        title: `${form.companyName} - Klaviyo Audit`,
        status: 'draft',
        audit_method: 'api' as Audit['audit_method'],
        list_size: 0,
        aov: 0,
        monthly_traffic: 0,
        total_revenue_opportunity: 0,
        executive_summary: '',
        created_by: user?.id || '',
        show_recommendations: true,
        layout: Object.keys(initialLayout).length > 0 ? initialLayout : undefined,
      } as any);

      if (attributionScreenshot) {
        try {
          const url = await uploadReportScreenshot(attributionScreenshot, 'attribution');
          await updateAudit(audit.id, {
            layout: { ...initialLayout, attribution_model: { sectionTitle: 'Attribution Model', screenshot_url: url } },
          });
        } catch { /* optional */ }
      }

      await createAuditSections(audit.id, [...KLAVIYO_AUDIT_SECTION_KEYS]);
      // Pass a one-time entered key so the workspace's first run can store the
      // connection; if a connection is already saved, form.apiKey is empty.
      if (mountedRef.current) navigate(`/audits/${audit.id}`, { state: { klaviyoApiKey: form.apiKey || undefined } });
    } catch (e: unknown) {
      setAnalyzing(false);
      submittingRef.current = false;
      setError(e instanceof Error ? e.message : 'Failed to create audit');
    }
  };

  const createDraftWeb = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setAnalyzing(true);
    try {
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
      } as any);

      await createAuditSections(audit.id, [...WEB_AUDIT_SECTION_KEYS]);

      // Persist the Shopify connection now so the workspace run can use it.
      if (!hasSavedShopifyConnection && form.shopifyToken.trim()) {
        const { data: connData, error: connErr } = await supabase.functions.invoke<any>('shopify_connect_client', {
          body: { client_id: clientId, shop_domain: form.shopifyDomain, access_token: form.shopifyToken },
        });
        if (connErr) throw new Error(`Shopify connection failed: ${connErr.message}`);
        if (!connData?.ok) throw new Error(connData?.error?.message || 'Shopify connection failed');
      }

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

        {stepKey === 'line_items' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-4 animate-slide-up mx-auto w-full max-w-2xl">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Line Items</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Optional. Select predefined revenue opportunities to include in the report. You can edit their copy and value later in the Line Item Catalog.
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

            {revenueTemplates.length > 0 ? (
              <div className="space-y-2">
                {revenueTemplates.map(template => {
                  const checked = form.selectedAddOnSlugs.includes(template.slug);
                  return (
                    <div
                      key={template.id}
                      className={`rounded-lg border px-3 py-2.5 transition-colors ${
                        checked ? 'border-brand-primary/30 bg-brand-primary/5' : 'border-gray-100 bg-white'
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
                                return { ...prev, selectedAddOnSlugs: next };
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
            ) : (
              <p className="text-sm text-gray-400">No predefined line items available. Add them in the Line Item Catalog.</p>
            )}
          </div>
        )}

        <div className="flex items-center mt-6 mx-auto w-full max-w-2xl">
          {step > 0 ? (
            <button
              onClick={() => { setError(''); setStep(step - 1); }}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : <span />}
          {step >= steps.length - 1 ? (
            <button
              onClick={() => { void (auditType === 'web' ? createDraftWeb() : createDraftKlaviyo()); }}
              disabled={!canProceed() || analyzing}
              className="ml-auto flex items-center gap-2 px-6 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Sparkles className="w-4 h-4" /> Create audit</>}
            </button>
          ) : (
            <button
              onClick={() => { setStep(step + 1); }}
              disabled={!canProceed()}
              className="ml-auto flex items-center gap-2 px-6 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
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
