import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Wifi,
  Camera,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditWizardStepper from '../components/audit/AuditWizardStepper';
import UploadDropzone from '../components/ui/UploadDropzone';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_CLIENTS } from '../lib/demo-data';
import { INDUSTRIES, ESP_PLATFORMS, SCREENSHOT_CATEGORIES } from '../lib/constants';
import { createAudit, createAuditAsset, createAuditSections, createClient, ensureClientCreator, updateAudit, updateAuditSection, uploadAuditAssetFile } from '../lib/db';
import type { Audit, Client } from '../lib/types';
import { runAIAnalysis } from '../lib/ai-service';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const STEPS = [
  { label: 'Prospect Details', description: 'Basic information' },
  { label: 'Data Method', description: 'API or screenshots' },
  { label: 'Data Inputs', description: 'Collect audit data' },
  { label: 'Run Analysis', description: 'AI-powered audit' },
];

export default function NewAudit() {
  const navigate = useNavigate();
  const { isDemo, user } = useAuth();
  const [step, setStep] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    companyName: '',
    industry: '',
    espPlatform: 'Klaviyo',
    websiteUrl: '',
    listSize: 0,
    aov: 0,
    monthlyTraffic: 0,
    notes: '',
    auditMethod: '' as '' | 'api' | 'screenshot',
    apiKey: '',
  });
  const [screenshots, setScreenshots] = useState<Record<string, File[]>>({});

  const [clients] = useState<Client[]>(isDemo ? DEMO_CLIENTS : []);

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
        industry: client.industry,
        espPlatform: client.esp_platform,
        websiteUrl: client.website_url,
      }));
    }
  };

  const runAnalysis = async () => {
    setError('');
    setAnalyzing(true);
    setAnalysisProgress(0);

    if (isDemo) {
      const labels = ['Account Health', 'Flows', 'Segmentation', 'Campaigns', 'Email Design', 'Signup Forms'];
      for (let i = 0; i < labels.length; i++) {
        await new Promise(r => setTimeout(r, 800));
        setAnalysisProgress(Math.round(((i + 1) / labels.length) * 100));
      }
      setAnalyzing(false);
      navigate('/audits/demo-audit-1');
      return;
    }

    try {
      // 1) Ensure client exists
      let clientId = form.clientId;
      if (!clientId) {
        const created = await createClient(await ensureClientCreator(user, {
          name: form.clientName || form.companyName,
          company_name: form.companyName,
          website_url: form.websiteUrl,
          industry: form.industry,
          esp_platform: form.espPlatform,
          api_key_placeholder: form.apiKey || '',
          notes: form.notes,
        }) as any);
        clientId = created.id;
      }

      // 2) Create audit row
      const title = `${form.companyName} - Klaviyo Audit`;
      const audit = await createAudit({
        client_id: clientId,
        title,
        status: 'in_progress',
        audit_method: form.auditMethod as Audit['audit_method'],
        list_size: Number(form.listSize) || 0,
        aov: Number(form.aov) || 0,
        monthly_traffic: Number(form.monthlyTraffic) || 0,
        total_revenue_opportunity: 0,
        executive_summary: '',
        created_by: user?.id || '',
        show_recommendations: true,
      } as any);

      // 3) Create default section rows
      const sectionKeys = ['account_health', 'flows', 'segmentation', 'campaigns', 'email_design', 'signup_forms', 'revenue_summary'];
      const createdSections = await createAuditSections(audit.id, sectionKeys);

      // 4) Upload screenshots (screenshot method)
      const mapCategoryToSection: Record<string, string> = {
        account_overview: 'account_health',
        flows: 'flows',
        campaigns: 'campaigns',
        segments: 'segmentation',
        signup_forms: 'signup_forms',
        email_examples: 'email_design',
      };

      const allFiles = Object.entries(screenshots).flatMap(([cat, files]) => files.map(f => ({ cat, file: f })));
      if (form.auditMethod === 'screenshot' && allFiles.length > 0) {
        // upload sequentially to keep progress meaningful
        for (let i = 0; i < allFiles.length; i++) {
          const { cat, file } = allFiles[i];
          const sectionKey = mapCategoryToSection[cat] ?? 'account_health';
          const uploaded = await uploadAuditAssetFile({
            auditId: audit.id,
            clientId,
            sectionKey,
            side: 'current',
            file,
          });
          await createAuditAsset({
            audit_id: audit.id,
            client_id: clientId,
            asset_type: 'screenshot',
            file_url: uploaded.publicUrl,
            file_name: file.name,
            section_key: sectionKey,
            side: 'current',
          });
          setAnalysisProgress(Math.round(((i + 1) / Math.max(1, allFiles.length)) * 30));
        }
      }

      // 5) Run AI analysis and persist section updates
      setAnalysisProgress(40);
      const ai = await runAIAnalysis({
        clientId,
        clientName: form.clientName,
        companyName: form.companyName,
        industry: form.industry,
        espPlatform: form.espPlatform,
        websiteUrl: form.websiteUrl,
        listSize: Number(form.listSize) || 0,
        aov: Number(form.aov) || 0,
        monthlyTraffic: Number(form.monthlyTraffic) || 0,
        notes: form.notes,
        auditMethod: form.auditMethod as any,
        apiKey: form.apiKey,
        screenshots,
      });
      setAnalysisProgress(70);

      // Apply AI updates by matching section_key
      for (const s of createdSections) {
        const patch = ai.sections.find(p => p.section_key === s.section_key);
        if (!patch) continue;
        await updateAuditSection(s.id, patch as any);
      }

      // Save exec summary onto audit
      await updateAudit(audit.id, { executive_summary: ai.executiveSummary } as any);

      setAnalysisProgress(100);
      setAnalyzing(false);
      navigate(`/audits/${audit.id}`);
    } catch (e: unknown) {
      setAnalyzing(false);
      setError(e instanceof Error ? e.message : 'Failed to run analysis');
    }
  };

  const canProceed = () => {
    if (step === 0) return form.companyName && form.industry;
    if (step === 1) return form.auditMethod;
    if (step === 2) return true;
    return true;
  };

  return (
    <div>
      <TopBar title="New Audit" subtitle="Create a new Klaviyo audit" />

      <div className="p-8 max-w-4xl animate-fade-in">
        <button
          onClick={() => step > 0 ? setStep(step - 1) : navigate('/')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {step > 0 ? 'Previous Step' : 'Back to Dashboard'}
        </button>

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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <Select value={form.industry} onValueChange={v => updateField('industry', v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ESP Platform</label>
                <Select value={form.espPlatform} onValueChange={v => updateField('espPlatform', v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESP_PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Website URL</label>
                <input
                  type="url"
                  value={form.websiteUrl}
                  onChange={e => updateField('websiteUrl', e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="https://example.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">List Size</label>
                <input
                  type="number"
                  value={form.listSize || ''}
                  onChange={e => updateField('listSize', Number(e.target.value))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="25,000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Average Order Value</label>
                <input
                  type="number"
                  value={form.aov || ''}
                  onChange={e => updateField('aov', Number(e.target.value))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="$65"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Traffic</label>
                <input
                  type="number"
                  value={form.monthlyTraffic || ''}
                  onChange={e => updateField('monthlyTraffic', Number(e.target.value))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="100,000"
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
          <div className="space-y-4 animate-slide-up">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">How would you like to collect data?</h2>
            <p className="text-sm text-gray-500 mb-6">Choose the method that best fits your situation.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => updateField('auditMethod', 'api')}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  form.auditMethod === 'api'
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                  form.auditMethod === 'api' ? 'bg-brand-primary/10' : 'bg-gray-100'
                }`}>
                  <Wifi className={`w-6 h-6 ${form.auditMethod === 'api' ? 'text-brand-primary' : 'text-gray-400'}`} />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">Direct API Connection</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Connect via Klaviyo private API key for automated data analysis.
                </p>
                <div className="flex items-center gap-1.5 text-xs font-medium text-brand-primary">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Recommended for Klaviyo accounts
                </div>
              </button>

              <button
                onClick={() => updateField('auditMethod', 'screenshot')}
                className={`p-6 rounded-xl border-2 text-left transition-all ${
                  form.auditMethod === 'screenshot'
                    ? 'border-brand-primary bg-brand-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                  form.auditMethod === 'screenshot' ? 'bg-brand-primary/10' : 'bg-gray-100'
                }`}>
                  <Camera className={`w-6 h-6 ${form.auditMethod === 'screenshot' ? 'text-brand-primary' : 'text-gray-400'}`} />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">Screenshot-Based Audit</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Upload screenshots from any ESP for manual analysis.
                </p>
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Works with any email platform
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 2 && form.auditMethod === 'api' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-5 animate-slide-up">
            <h2 className="text-lg font-semibold text-gray-900">API Connection</h2>
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

        {step === 2 && form.auditMethod === 'screenshot' && (
          <div className="bg-white rounded-xl p-6 card-shadow space-y-6 animate-slide-up">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Upload Screenshots</h2>
              <p className="text-sm text-gray-500">
                Upload screenshots for each category below. This helps our AI analyze the account.
              </p>
            </div>

            {SCREENSHOT_CATEGORIES.map(cat => (
              <div key={cat.key} className="border-t border-gray-50 pt-5 first:border-0 first:pt-0">
                <UploadDropzone
                  label={cat.label}
                  description={cat.description}
                  files={screenshots[cat.key] || []}
                  onFilesChange={files => setScreenshots(prev => ({ ...prev, [cat.key]: files }))}
                />
              </div>
            ))}
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
                  Generating findings across all audit sections.
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
              </>
            )}
          </div>
        )}

        {step < 3 && (
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
    </div>
  );
}
