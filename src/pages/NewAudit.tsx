import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditWizardStepper from '../components/audit/AuditWizardStepper';
import { useAuth } from '../contexts/AuthContext';
import { formatClientListMeta } from '../lib/client-display';
import { createAudit, createAuditSections, createClient, ensureClientCreator, listClients, updateAudit, updateAuditSection, updateClient, getIndustryEmailByIndustry, upsertAuditEmailDesign, createAnnotation } from '../lib/db';
import type { Audit, AuditContext, Client } from '../lib/types';
import { runAIAnalysis } from '../lib/ai-service';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../components/ui/select';
import { IndustrySelectWithCustom } from '../components/ui/IndustrySelect';
import { supabase } from '../lib/supabase';
import { KlaviyoApiKeyHelpTrigger } from '../components/klaviyo/KlaviyoApiKeyHelpModal';

const CONTEXT_CHAR_SOFT = 15_000;
const CONTEXT_CHAR_HARD = 30_000;

const STEPS = [
  { label: 'Prospect Details', description: 'Basic information' },
  { label: 'API Connection', description: 'Connect Klaviyo data' },
  { label: 'Client Context', description: 'Optional notes for the AI' },
  { label: 'Run Analysis', description: 'AI-powered audit' },
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

/** Poll until Edge function finishes full Klaviyo profile pagination (multi-invocation). */
async function waitForProfileJobComplete(
  auditId: string,
  onProgress?: (totalProfiles: number) => void,
) {
  const maxMs = 45 * 60 * 1000;
  const t0 = Date.now();
  let lastUpdated = '';
  let staleCount = 0;
  while (Date.now() - t0 < maxMs) {
    const { data, error } = await supabase
      .from('klaviyo_profile_scan_jobs')
      .select('status, error_message, total_profiles, updated_at')
      .eq('audit_id', auditId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Profile scan job not found');
    if (data.status === 'complete' || data.status === 'skipped') {
      onProgress?.(data.total_profiles ?? 0);
      return;
    }
    if (data.status === 'failed') {
      throw new Error(data.error_message || 'Audience metrics scan failed');
    }
    onProgress?.(data.total_profiles ?? 0);

    // Detect stalled scan and re-trigger the resume chain
    if (data.updated_at === lastUpdated) {
      staleCount++;
    } else {
      staleCount = 0;
      lastUpdated = data.updated_at ?? '';
    }
    if (staleCount >= 5) {
      staleCount = 0;
      invokeKlaviyoSnapshot({ mode: 'resume_profile_scan', audit_id: auditId }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Audience metrics scan timed out. Try again or contact support.');
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
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState<string>('');
  const [error, setError] = useState('');
  const [fullProfileScan, setFullProfileScan] = useState(false);
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
  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    companyName: '',
    industry: '',
    notes: '',
    apiKey: '',
  });

  const [auditContextForm, setAuditContextForm] = useState({
    meeting_notes: '',
    client_background: '',
    custom_instructions: '',
  });

  const [clients, setClients] = useState<Client[]>([]);
  const selectedClient = form.clientId ? clients.find(c => c.id === form.clientId) : undefined;
  const hasSavedKlaviyoConnection = Boolean((selectedClient as any)?.klaviyo_connected);

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

  function buildAuditContextForSave(): AuditContext | null {
    const meeting_notes = auditContextForm.meeting_notes.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    const client_background = auditContextForm.client_background.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    const custom_instructions = auditContextForm.custom_instructions.trim().slice(0, CONTEXT_CHAR_HARD) || undefined;
    if (!meeting_notes && !client_background && !custom_instructions) return null;
    return { meeting_notes, client_background, custom_instructions };
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
        notes: client.notes ?? '',
        apiKey: '',
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

  const runAnalysis = async () => {
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
        const created = await createClient(await ensureClientCreator(user, {
          name: form.clientName || form.companyName,
          company_name: form.companyName,
          website_url: '',
          industry: form.industry,
          esp_platform: 'Klaviyo',
          api_key_placeholder: '',
          notes: form.notes,
        }) as any);
        clientId = created.id;
      } else {
        const patch: Record<string, string> = { notes: form.notes };
        if (form.industry) patch.industry = form.industry;
        const updated = await updateClient(clientId, patch);
        setClients(prev => prev.map(c => (c.id === updated.id ? updated : c)));
      }

      // 2) Create audit row
      setAnalysisStage('Creating audit…');
      const title = `${form.companyName} - Klaviyo Audit`;
      const contextPayload = buildAuditContextForSave();
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
      } as any);

      // 3) Create default section rows
      setAnalysisStage('Setting up audit sections…');
      const sectionKeys = ['account_health', 'flows', 'segmentation', 'campaigns', 'email_design', 'signup_forms', 'revenue_summary'];
      const createdSections = await createAuditSections(audit.id, sectionKeys);

      // 4) Fetch Klaviyo snapshot (API only)
      setAnalysisProgress(35);
      setAnalysisStage('Fetching Klaviyo account data…');
      const snapshotPayload = {
        audit_id: audit.id,
        client_id: clientId,
        api_key: form.apiKey || undefined,
        profile_scan: fullProfileScan ? ('full' as const) : ('fast' as const),
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

      const profilePending = (data as { profile_metrics_status?: string })?.profile_metrics_status === 'pending';
      if (profilePending) {
        setAnalysisStage('Finishing audience metrics (full Klaviyo profile scan)…');
        await waitForProfileJobComplete(audit.id, (totalProfiles) => {
          setAnalysisStage(
            totalProfiles > 0
              ? `Scanning profiles… ${totalProfiles.toLocaleString()} scanned so far`
              : 'Finishing audience metrics (full Klaviyo profile scan)…',
          );
        });
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
      }

      // 5) Run AI analysis and persist section updates
      setAnalysisProgress(40);
      setAnalysisStage('Running AI analysis…');
      const ticker = setInterval(() => {
        setAnalysisProgress(prev => {
          if (prev >= 68) return 68;
          return Math.round((prev + (68 - prev) * 0.08) * 10) / 10;
        });
      }, 2000);
      let ai;
      try {
        ai = await runAIAnalysis({
          auditId: audit.id,
          clientId,
          clientName: form.clientName,
          companyName: form.companyName,
          espPlatform: 'Klaviyo',
          websiteUrl: '',
          listSize: snapshotListSize,
          aov: snapshotRpr,
          monthlyTraffic: snapshotEngagement,
          notes: form.notes,
          auditMethod: 'api' as any,
          auditContext: contextPayload ?? undefined,
          profileAudienceScan: fullProfileScan ? 'full' : 'skipped',
        }, (update) => {
          if (update.total > 0) {
            setAnalysisStage(update.label);
            const mapped = 40 + Math.round((update.current / update.total) * 28);
            setAnalysisProgress(prev => Math.max(prev, Math.min(68, mapped)));
          } else if (update.label) {
            setAnalysisStage(update.label);
          }
        });
      } finally {
        clearInterval(ticker);
      }
      setAnalysisProgress(70);
      setAnalysisStage('Saving results…');

      // Apply AI updates by matching section_key
      for (const s of createdSections) {
        const patch = ai.sections.find(p => p.section_key === s.section_key);
        if (!patch) continue;
        await updateAuditSection(s.id, patch as any);
      }

      const totalOpportunity = ai.sections.reduce((sum, s) => sum + (Number((s as any).revenue_opportunity) || 0), 0);

      const execPayload = (ai.strengths?.length || ai.concerns?.length || ai.implementationTimeline?.length)
        ? JSON.stringify({ text: ai.executiveSummary, strengths: ai.strengths ?? [], concerns: ai.concerns ?? [], timeline: ai.implementationTimeline ?? [] })
        : ai.executiveSummary;

      await updateAudit(audit.id, {
        executive_summary: execPayload,
        total_revenue_opportunity: totalOpportunity,
        list_size: snapshotListSize,
        monthly_traffic: snapshotEngagement,
        aov: snapshotRpr,
      } as any);

      // Best-effort: match industry → ECD benchmark email + copy annotations
      try {
        const industry = form.industry || clients.find(c => c.id === clientId)?.industry || '';
        if (industry) {
          const ecdExample = await getIndustryEmailByIndustry(industry);
          if (ecdExample) {
            await upsertAuditEmailDesign(audit.id, { ecd_example_id: ecdExample.id });
            const emailDesignSection = createdSections.find(s => s.section_key === 'email_design');
            if (emailDesignSection && ecdExample.default_annotations?.length) {
              for (const ann of ecdExample.default_annotations) {
                await createAnnotation({
                  audit_section_id: emailDesignSection.id,
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
      } catch { /* non-critical */ }

      setAnalysisProgress(100);
      setAnalysisStage('Done');
      setAnalyzing(false);
      navigate(`/audits/${audit.id}`);
    } catch (e: unknown) {
      setAnalyzing(false);
      setError(e instanceof Error ? e.message : 'Failed to run analysis');
    }
  };

  const canProceed = () => {
    if (step === 0) return form.companyName;
    if (step === 1) return hasSavedKlaviyoConnection || form.apiKey;
    if (step === 2) return true;
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
          <AuditWizardStepper steps={STEPS} currentStep={step} />
        </div>

        {step === 0 && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up">
            <h2 className="text-lg font-semibold text-gray-900">Prospect Details</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Existing Client</label>
              <Select value={form.clientId || undefined} onValueChange={v => handleClientSelect(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Create new client or select existing" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="max-h-[min(360px,70vh)] min-w-[var(--radix-select-trigger-width)] max-w-md"
                  sideOffset={4}
                >
                  {clients.map(c => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      textValue={c.company_name}
                      className="items-start py-2.5 pl-8 pr-3"
                    >
                      <div className="flex flex-col gap-0.5 pr-1">
                        <SelectItemText className="font-medium leading-snug text-gray-900">
                          {c.company_name}
                        </SelectItemText>
                        <span className="text-[11px] leading-snug text-gray-500">{formatClientListMeta(c)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
                placeholder="Any relevant context about this prospect..."
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up">
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

        {step === 2 && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-6 animate-slide-up">
            {error ? (
              <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
            ) : null}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Client Context</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                  Optional. Paste meeting notes from Fireflies, Fathom, Google Meet, or any tool. Add what the client cares about so the report matches their conversation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setError(''); setStep(3); }}
                className="text-sm text-brand-primary font-medium hover:underline whitespace-nowrap"
              >
                Skip this step
              </button>
            </div>

            <details className="group border border-gray-200 rounded-lg open:ring-1 open:ring-brand-primary/15" open>
              <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 font-medium text-gray-900 bg-gray-50/80 rounded-lg group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
                <span>Meeting notes & transcripts</span>
                <span className="text-xs text-gray-500 font-normal">Fireflies, Fathom, etc.</span>
              </summary>
              <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-2">
                <label className="block text-xs font-medium text-gray-600">Paste notes or transcript</label>
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
          </div>
        )}

        {step === 3 && (
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
                <h2 className="text-xl font-bold text-gray-900 mb-2">Ready to Analyze</h2>
                <p className="text-sm text-gray-500 max-w-md mx-auto mb-4">
                  Our AI will review the collected data and generate detailed findings for each audit section.
                  You'll be able to review and edit everything before publishing.
                </p>
                <label className="flex items-start gap-2.5 max-w-md mx-auto mb-6 text-left text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fullProfileScan}
                    onChange={(e) => setFullProfileScan(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/30"
                  />
                  <span>
                    <span className="font-medium text-gray-900">Full Klaviyo profile scan</span>
                    {' '}
                    (exact list size, subscribed, suppressed, and active-profile counts). Large accounts can take a long time. Leave unchecked for a{' '}
                    <span className="font-medium">faster audit</span>
                    {' '}
                    without those audience totals (Klaviyo does not expose them without scanning profiles).
                  </span>
                </label>
                <button
                  onClick={runAnalysis}
                  className="inline-flex items-center gap-2 px-6 py-3 gradient-bg text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  <Sparkles className="w-4 h-4" />
                  Run AI Analysis
                </button>
              </>
            ) : (
              <>
                <Loader2 className="w-12 h-12 text-brand-primary animate-spin mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">Analyzing Account...</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {analysisStage || 'Generating findings across all audit sections.'}
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
                      label: 'Fetch Klaviyo snapshot',
                      done: analysisProgress >= 40,
                      active: analysisProgress >= 10 && analysisProgress < 40,
                    },
                    {
                      key: 'ai',
                      label: 'Run AI analysis',
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
                  const fetch = snapshotMeta.fetch as Record<string, { ok: boolean }> | undefined;
                  const resources = ['flows', 'campaigns', 'segments', 'forms', 'lists'] as const;
                  const failedScopes = fetch ? resources.filter(r => fetch[r] && !fetch[r].ok) : [];
                  return (
                    <div className="max-w-md mx-auto mt-4 text-left bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Klaviyo data pulled</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                        {resources.filter(r => r !== 'lists').map(r => {
                          const ok = fetch ? fetch[r]?.ok : true;
                          const count = snapshotMeta.counts?.[r];
                          return (
                            <div key={r} className="flex items-center justify-between">
                              <span className="capitalize">{r}</span>
                              {ok === false ? (
                                <span className="font-medium text-amber-600">No access</span>
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
              </>
            )}
          </div>
        )}

        {step < 3 && (
          <div className="flex justify-end mt-6">
            <button
              onClick={() => {
                if (step === 2) setError('');
                setStep(step + 1);
              }}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
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
      <TopBar title="New Audit" subtitle="Create a new Klaviyo audit" />
      <div className="animate-fade-in">{body}</div>
    </div>
  );
}
