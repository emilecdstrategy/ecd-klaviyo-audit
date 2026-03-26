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
import { DEMO_CLIENTS } from '../lib/demo-data';
import { createAudit, createAuditSections, createClient, ensureClientCreator, listClients, updateAudit, updateAuditSection } from '../lib/db';
import type { Audit, Client } from '../lib/types';
import { runAIAnalysis } from '../lib/ai-service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { supabase } from '../lib/supabase';

const STEPS = [
  { label: 'Prospect Details', description: 'Basic information' },
  { label: 'API Connection', description: 'Connect Klaviyo data' },
  { label: 'Run Analysis', description: 'AI-powered audit' },
];

type NewAuditProps = { asModal?: boolean };

export default function NewAudit({ asModal }: NewAuditProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDemo, user } = useAuth();
  const [step, setStep] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState<string>('');
  const [error, setError] = useState('');
  const [snapshotMeta, setSnapshotMeta] = useState<null | {
    counts?: Record<string, number | null>;
    reporting?: { flow_reports?: Array<{ timeframe: string; rows: number }>; campaign_reports?: Array<{ timeframe: string; rows: number }> };
    fetch?: any;
    elapsed_ms?: number;
    correlationId?: string;
  }>(null);
  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    companyName: '',
    notes: '',
    apiKey: '',
  });

  const [clients, setClients] = useState<Client[]>(isDemo ? DEMO_CLIENTS : []);
  const selectedClient = form.clientId ? clients.find(c => c.id === form.clientId) : undefined;
  const hasSavedKlaviyoConnection = Boolean((selectedClient as any)?.klaviyo_connected);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) return;
    (async () => {
      try {
        const c = await listClients();
        if (!cancelled) setClients(c);
      } catch {
        // ignore; audit can still create new client
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

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

  const handleClientSelect = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setForm(prev => ({
        ...prev,
        clientId,
        clientName: client.name,
        companyName: client.company_name,
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

    if (isDemo) {
      const labels = ['Account Health', 'Flows', 'Segmentation', 'Campaigns', 'Email Design', 'Signup Forms'];
      for (let i = 0; i < labels.length; i++) {
        await new Promise(r => setTimeout(r, 800));
        setAnalysisProgress(Math.round(((i + 1) / labels.length) * 100));
        setAnalysisStage(`Analyzing ${labels[i]}…`);
      }
      setAnalyzing(false);
      navigate('/audits/demo-audit-1');
      return;
    }

    try {
      // 1) Ensure client exists
      setAnalysisStage('Preparing client…');
      let clientId = form.clientId;
      if (!clientId) {
        const created = await createClient(await ensureClientCreator(user, {
          name: form.clientName || form.companyName,
          company_name: form.companyName,
          website_url: '',
            industry: '',
          esp_platform: 'Klaviyo',
          api_key_placeholder: '',
          notes: form.notes,
        }) as any);
        clientId = created.id;
      }

      // 2) Create audit row
      setAnalysisStage('Creating audit…');
      const title = `${form.companyName} - Klaviyo Audit`;
      const audit = await createAudit({
        client_id: clientId,
        title,
        status: 'in_progress',
        audit_method: 'api' as Audit['audit_method'],
        list_size: 0,
        aov: 0,
        monthly_traffic: 0,
        total_revenue_opportunity: 0,
        executive_summary: '',
        created_by: user?.id || '',
        show_recommendations: true,
      } as any);

      // 3) Create default section rows
      setAnalysisStage('Setting up audit sections…');
      const sectionKeys = ['account_health', 'flows', 'segmentation', 'campaigns', 'email_design', 'signup_forms', 'revenue_summary'];
      const createdSections = await createAuditSections(audit.id, sectionKeys);

      // 4) Fetch Klaviyo snapshot (API only)
      setAnalysisProgress(35);
      setAnalysisStage('Fetching Klaviyo account data…');
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error: fnErr } = await supabase.functions.invoke<any>('klaviyo_fetch_snapshot', {
        body: {
          audit_id: audit.id,
          client_id: clientId,
          api_key: form.apiKey || undefined,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (fnErr) throw fnErr;
      if (!data?.ok) throw new Error(data?.error?.message || 'Failed to fetch Klaviyo snapshot');
      setSnapshotMeta({
        counts: data?.counts,
        fetch: (data as any)?.fetch,
        reporting: data?.reporting,
        elapsed_ms: data?.elapsed_ms,
        correlationId: data?.correlationId,
      });

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
          listSize: 0,
          aov: 0,
          monthlyTraffic: 0,
          notes: form.notes,
          auditMethod: 'api' as any,
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
      } as any);

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
              <Select value={form.clientId} onValueChange={v => handleClientSelect(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Create new client or select existing" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Klaviyo Private API Key</label>
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
                <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
                  Our AI will review the collected data and generate detailed findings for each audit section.
                  You'll be able to review and edit everything before publishing.
                </p>
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
                      
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {step < 2 && (
          <div className="flex justify-end mt-6">
            <button
              onClick={() => setStep(step + 1)}
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
