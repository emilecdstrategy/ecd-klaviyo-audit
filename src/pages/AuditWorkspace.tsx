import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, BarChart3, LayoutGrid as Layout, Target, Mail, Palette, FormInput, DollarSign, ExternalLink, Maximize2, X as XIcon, Check } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditSectionEditor from '../components/audit/AuditSectionEditor';
import RevenueOpportunityCard from '../components/ui/RevenueOpportunityCard';
import ShareLinkPanel from '../components/ui/ShareLinkPanel';
import StatusBadge from '../components/ui/StatusBadge';
import { SkeletonAuditWorkspace } from '../components/ui/Skeleton';
import { SECTION_KEYS, SECTION_LABELS, CONFIDENCE_LABELS } from '../lib/constants';
import { formatCurrency } from '../lib/revenue-calculator';
import type { AuditSection, Annotation, AuditEmailDesign, IndustryEmailLibrary } from '../lib/types';
import type { Audit, AuditAsset, Client } from '../lib/types';
import { createAnnotation, deleteAnnotation, getAudit, getClient, listAnnotationsForAuditSections, listAssets, listAuditSections, publishAudit, updateAudit, updateAuditStatus, updateAuditSection, getAuditEmailDesign, upsertAuditEmailDesign, listIndustryEmailLibrary, getPlatformSettings } from '../lib/db';
import { supabase } from '../lib/supabase';
import SimpleRichEditor from '../components/ui/SimpleRichEditor';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../components/ui/select';
import AnnotationLayer from '../components/audit/AnnotationLayer';
import { useToast } from '../components/ui/Toast';

const SECTION_ICONS: Record<string, React.ElementType> = {
  account_health: BarChart3,
  flows: Layout,
  segmentation: Target,
  campaigns: Mail,
  email_design: Palette,
  signup_forms: FormInput,
  revenue_summary: DollarSign,
};

export default function AuditWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [audit, setAudit] = useState<Audit | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [assets, setAssets] = useState<AuditAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sections, setSections] = useState<AuditSection[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeSection, setActiveSection] = useState<string>(SECTION_KEYS[0]);

  const [emailDesign, setEmailDesign] = useState<AuditEmailDesign | null>(null);
  const [emailLibrary, setEmailLibrary] = useState<IndustryEmailLibrary[]>([]);

  const saveTimers = useRef<Record<string, number>>({});
  const execSaveTimer = useRef<number>(0);
  const [publishBlockedReason, setPublishBlockedReason] = useState<string>('');
  const [scopeWarnings, setScopeWarnings] = useState<string[]>([]);
  /** Rollup-derived KPIs when audit row still has zeros (older API audits). */
  const [kpiFromSnapshot, setKpiFromSnapshot] = useState<{
    list_size: number | null;
    aov: number | null;
    monthly_traffic: number | null;
  } | null>(null);

  // Hooks must run unconditionally on every render.
  // Compute derived values before any early returns to avoid hook-order crashes.
  const totalRevenue = useMemo(
    () => sections.reduce((sum, sec) => sum + (Number(sec.revenue_opportunity) || 0), 0),
    [sections],
  );
  const currentSection = sections.find(s => s.section_key === activeSection);

  const auditInfoMetrics = useMemo(() => {
    if (!audit) return { list_size: 0, aov: 0, monthly_traffic: 0 };
    if (audit.audit_method !== 'api' || !kpiFromSnapshot) {
      return {
        list_size: audit.list_size ?? 0,
        aov: audit.aov ?? 0,
        monthly_traffic: audit.monthly_traffic ?? 0,
      };
    }
    const k = kpiFromSnapshot;
    const pick = (col: number, snap: number | null | undefined) =>
      (col != null && col > 0) ? col : (snap ?? col ?? 0);
    return {
      list_size: pick(audit.list_size, k.list_size ?? null),
      aov: pick(audit.aov, k.aov ?? null),
      monthly_traffic: pick(audit.monthly_traffic, k.monthly_traffic ?? null),
    };
  }, [audit, kpiFromSnapshot]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const a = await getAudit(id);
        if (!a) throw new Error('Audit not found');
        const c = await getClient(a.client_id);
        const [secs, as, ed, lib] = await Promise.all([
          listAuditSections(id),
          listAssets(id),
          getAuditEmailDesign(id),
          listIndustryEmailLibrary(),
        ]);
        const anns = await listAnnotationsForAuditSections(secs.map(s => s.id));
        if (cancelled) return;
        setAudit(a);
        setClient(c);
        setSections(secs);
        setAssets(as);
        setAnnotations(anns);
        setEmailDesign(ed);
        setEmailLibrary(lib);

        // Check Klaviyo scope warnings for API audits
        if (a.audit_method === 'api') {
          try {
            const { data: conn } = await supabase
              .from('klaviyo_connections')
              .select('scopes')
              .eq('client_id', a.client_id)
              .maybeSingle();
            if (conn?.scopes) {
              const missing = Object.entries(conn.scopes as Record<string, unknown>)
                .filter(([, v]) => v !== true)
                .map(([k]) => k);
              if (missing.length > 0) setScopeWarnings(missing);
            }
          } catch {
            // non-critical
          }
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!audit || audit.audit_method !== 'api') {
      setKpiFromSnapshot(null);
      return;
    }
    let cancelled = false;
    setKpiFromSnapshot(null);
    (async () => {
      const { data: rollup } = await supabase
        .from('klaviyo_reporting_rollups')
        .select('computed')
        .eq('audit_id', audit.id)
        .eq('timeframe_key', 'last_30_days')
        .maybeSingle();
      const snap = (rollup?.computed as { account_snapshot?: { email_subscribed_profiles_count?: number | null; active_profiles_90d_count?: number | null } } | null)?.account_snapshot;
      const { data: fpRows } = await supabase
        .from('flow_performance')
        .select('monthly_revenue_current, recipients_per_month')
        .eq('audit_id', audit.id);
      let rpr: number | null = null;
      if (fpRows?.length) {
        const totalRev = fpRows.reduce((s, r) => s + (Number(r.monthly_revenue_current) || 0), 0);
        const totalRecip = fpRows.reduce((s, r) => s + (Number(r.recipients_per_month) || 0), 0);
        if (totalRecip > 0) rpr = Math.round((totalRev / totalRecip) * 100) / 100;
      }
      if (cancelled) return;
      setKpiFromSnapshot({
        list_size: snap?.email_subscribed_profiles_count ?? null,
        monthly_traffic: snap?.active_profiles_90d_count ?? null,
        aov: rpr,
      });
    })();
    return () => { cancelled = true; };
  }, [audit?.id, audit?.audit_method]);

  if (loading) {
    return (
      <div>
        <TopBar title="Audit" />
        <SkeletonAuditWorkspace />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <TopBar title="Audit" />
        <div className="p-8">
          <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
          <button onClick={() => navigate('/')} className="mt-4 text-sm text-brand-primary font-medium hover:underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!audit) {
    return (
      <div>
        <TopBar title="Audit Not Found" />
        <div className="p-8 text-center">
          <p className="text-gray-500">This audit could not be found.</p>
          <button onClick={() => navigate('/')} className="mt-4 text-sm text-brand-primary font-medium hover:underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleSectionUpdate = (sectionId: string, updates: Partial<AuditSection>) => {
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, ...updates } : s)));
    if (saveTimers.current[sectionId]) window.clearTimeout(saveTimers.current[sectionId]);
    saveTimers.current[sectionId] = window.setTimeout(async () => {
      try {
        await updateAuditSection(sectionId, updates);
        toast('Changes saved');
      } catch {
        // keep UI responsive; errors surface on next reload
      }
    }, 400);
  };

  const handlePublish = async () => {
    if (!audit) return;
    try {
      const updated = await publishAudit(audit.id);
      setAudit(updated);
      setPublishBlockedReason('');
    } catch (e) {
      setPublishBlockedReason(e instanceof Error ? e.message : 'Failed to publish. Please try again.');
    }
  };

  return (
    <div>
      <TopBar
        title={audit.title}
        subtitle={client?.company_name}
        actions={
          audit.public_share_token ? (
            <a
              href={`/report/${audit.public_share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View Report
            </a>
          ) : undefined
        }
      />

      {scopeWarnings.length > 0 && (
        <div className="mx-6 mt-3 px-4 py-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
          <strong>Incomplete Klaviyo data:</strong> Your API key is missing permissions for <strong>{scopeWarnings.join(', ')}</strong>.
          Regenerate the key in Klaviyo with full read access, then re-run the audit for complete data.
        </div>
      )}

      <div className="flex h-[calc(100vh-64px)]">
        <div className="hidden lg:block w-56 bg-white border-r border-gray-100 p-3 overflow-y-auto shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-3 mb-2">
            Audit Sections
          </p>
          {SECTION_KEYS.map(key => {
            const Icon = SECTION_ICONS[key] || FileText;
            const section = sections.find(s => s.section_key === key);
            const isActive = activeSection === key;
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-all mb-0.5 ${
                  isActive
                    ? 'bg-brand-primary/10 text-brand-primary font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate text-xs">{SECTION_LABELS[key]}</span>
                {section && section.status === 'approved' && (
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 ml-auto" />
                )}
              </button>
            );
          })}

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
            <div className="px-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <Select
                value={audit.status}
                onValueChange={async (v) => {
                  const newStatus = v as Audit['status'];
                  try {
                    const updated = await updateAuditStatus(audit.id, newStatus);
                    setAudit(updated);
                    toast('Status updated');
                  } catch (e) {
                    console.error('Failed to update status:', e);
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft"><SelectItemText>Draft</SelectItemText></SelectItem>
                  <SelectItem value="in_review"><SelectItemText>In Review</SelectItemText></SelectItem>
                  <SelectItem value="viewer_only"><SelectItemText>Viewer Only</SelectItemText></SelectItem>
                  <SelectItem value="published"><SelectItemText>Published</SelectItemText></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <RevenueOpportunityCard amount={totalRevenue} compact />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeSection === 'email_design' ? (
            <EmailDesignEditor
              audit={audit}
              emailDesign={emailDesign}
              emailLibrary={emailLibrary}
              annotations={annotations}
              section={currentSection ?? null}
              onAnnotationsChange={setAnnotations}
              onEmailDesignChange={setEmailDesign}
              onSectionUpdate={currentSection ? (updates) => handleSectionUpdate(currentSection.id, updates) : undefined}
            />
          ) : activeSection === 'revenue_summary' ? (
            <div className="space-y-6 animate-slide-up">
              <div className="bg-white rounded-xl p-6 card-shadow">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue Opportunity Summary</h2>
                <RevenueOpportunityCard amount={totalRevenue} label="Total Estimated Monthly Impact" confidence="high" />
              </div>

              <div className="bg-white rounded-xl p-6 card-shadow">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Breakdown by Section</h3>
                <div className="space-y-3">
                  {sections
                    .filter(s => s.revenue_opportunity > 0)
                    .sort((a, b) => b.revenue_opportunity - a.revenue_opportunity)
                    .map(s => {
                      const pct = totalRevenue > 0 ? (s.revenue_opportunity / totalRevenue) * 100 : 0;
                      return (
                        <div key={s.id} className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-800 truncate">
                                {SECTION_LABELS[s.section_key]}
                              </span>
                              <span className="text-sm font-semibold text-gray-900">
                                {formatCurrency(s.revenue_opportunity)}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full gradient-bg rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-gray-400 w-10 text-right">{Math.round(pct)}%</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 card-shadow">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Executive Summary</h3>
                <SimpleRichEditor
                  value={(() => {
                    const raw = audit.executive_summary || '';
                    try {
                      const parsed = JSON.parse(raw);
                      if (parsed && typeof parsed.text === 'string') return parsed.text.replace(/\*\*(.+?)\*\*/g, '$1');
                    } catch { /* not JSON, use as-is */ }
                    return raw.replace(/\*\*(.+?)\*\*/g, '$1');
                  })()}
                  onChange={(val) => {
                    let payload = val;
                    try {
                      const parsed = JSON.parse(audit.executive_summary || '');
                      if (parsed && typeof parsed.text === 'string') {
                        payload = JSON.stringify({ ...parsed, text: val });
                      }
                    } catch { /* not JSON, save as plain text */ }
                    setAudit(prev => prev ? { ...prev, executive_summary: payload } : prev);
                    if (execSaveTimer.current) window.clearTimeout(execSaveTimer.current);
                    execSaveTimer.current = window.setTimeout(async () => {
                      try { await updateAudit(audit.id, { executive_summary: payload }); toast('Summary saved'); } catch { /* silent */ }
                    }, 800);
                  }}
                  rows={5}
                  placeholder="Enter the executive summary..."
                />
              </div>
            </div>
          ) : currentSection ? (
            <AuditSectionEditor
              section={currentSection}
              onUpdate={updates => handleSectionUpdate(currentSection.id, updates)}
            />
          ) : (
            <div className="bg-white rounded-xl p-8 card-shadow text-center">
              <p className="text-sm text-gray-500">
                No data for this section yet. Run AI analysis to generate findings.
              </p>
            </div>
          )}
        </div>

        <div className={`${activeSection === 'email_design' ? 'hidden' : 'hidden xl:block'} w-[360px] 2xl:w-[420px] bg-white border-l border-gray-100 p-4 overflow-y-auto shrink-0 space-y-4`}>
          <ShareLinkPanel
            shareToken={audit.public_share_token}
            onPublish={handlePublish}
            isPublished={audit.status === 'published'}
            publishDisabled={audit.audit_method === 'api' && audit.status !== 'published' && Boolean(publishBlockedReason)}
            publishDisabledReason={publishBlockedReason || undefined}
          />

          {currentSection && currentSection.revenue_opportunity > 0 && (
            <RevenueOpportunityCard
              amount={currentSection.revenue_opportunity}
              confidence={currentSection.confidence}
              label="Section Impact"
            />
          )}

          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Audit Info</h4>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Method</span>
                <span className="font-medium text-gray-800">
                  {audit.audit_method === 'api' ? 'API' : audit.audit_method === 'screenshot' ? 'Screenshot' : audit.audit_method}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">List size</span>
                <span className="font-medium text-gray-800">{auditInfoMetrics.list_size.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {audit.audit_method === 'api' ? 'Flow $/recipient' : 'AOV'}
                </span>
                <span className="font-medium text-gray-800">{formatCurrency(auditInfoMetrics.aov)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {audit.audit_method === 'api' ? 'Engaged (90d)' : 'Traffic'}
                </span>
                <span className="font-medium text-gray-800">{auditInfoMetrics.monthly_traffic.toLocaleString()}/mo</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailDesignEditor({
  audit,
  emailDesign,
  emailLibrary,
  annotations,
  section,
  onAnnotationsChange,
  onEmailDesignChange,
  onSectionUpdate,
}: {
  audit: Audit;
  emailDesign: AuditEmailDesign | null;
  emailLibrary: IndustryEmailLibrary[];
  annotations: Annotation[];
  section: AuditSection | null;
  onAnnotationsChange: (anns: Annotation[]) => void;
  onEmailDesignChange: (ed: AuditEmailDesign | null) => void;
  onSectionUpdate?: (updates: Partial<AuditSection>) => void;
}) {
  const [selectedEcdId, setSelectedEcdId] = useState(emailDesign?.ecd_example_id || '');
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [globalAnnotationSize, setGlobalAnnotationSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [globalAnnotationsExpanded, setGlobalAnnotationsExpanded] = useState(false);

  useEffect(() => {
    getPlatformSettings().then(s => {
      setGlobalAnnotationSize(s.annotation_size);
      setGlobalAnnotationsExpanded(s.annotations_expanded);
    }).catch(() => {});
  }, []);

  const ecdExample = emailDesign?.ecd_example || emailLibrary.find(e => e.id === selectedEcdId) || null;
  const sectionAnns = section ? annotations.filter(a => a.audit_section_id === section.id) : [];
  const clientAnns = sectionAnns.filter(a => a.side === 'current');
  const ecdAnns = sectionAnns.filter(a => a.side === 'optimized');

  const handleSelectEcd = async (newId: string) => {
    setSelectedEcdId(newId);
    if (!section) return;
    try {
      setSaving(true);
      const updated = await upsertAuditEmailDesign(audit.id, { ecd_example_id: newId || null });
      onEmailDesignChange(updated);

      // Remove old optimized-side annotations for this section, then copy library defaults
      const oldOptimized = annotations.filter(a => a.audit_section_id === section.id && a.side === 'optimized');
      for (const old of oldOptimized) {
        try { await deleteAnnotation(old.id); } catch { /* ignore */ }
      }
      let updatedAnns = annotations.filter(a => !(a.audit_section_id === section.id && a.side === 'optimized'));

      const libEntry = emailLibrary.find(e => e.id === newId);
      if (libEntry?.default_annotations?.length) {
        for (const ann of libEntry.default_annotations) {
          try {
            const created = await createAnnotation({
              audit_section_id: section.id,
              asset_id: null,
              x_position: ann.x,
              y_position: ann.y,
              label: ann.label,
              side: 'optimized',
            });
            updatedAnns = [...updatedAnns, created];
          } catch (e) {
            console.error('Failed to copy library annotation:', e);
          }
        }
      }
      onAnnotationsChange(updatedAnns);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleAddAnnotation = async (side: 'current' | 'optimized', x: number, y: number, label: string) => {
    if (!section) return;
    try {
      const created = await createAnnotation({
        audit_section_id: section.id,
        asset_id: null,
        x_position: x,
        y_position: y,
        label,
        side,
      });
      onAnnotationsChange([...annotations, created]);
    } catch (e) {
      console.error('Failed to save annotation:', e);
    }
  };

  const handleRemoveAnnotation = async (annId: string) => {
    onAnnotationsChange(annotations.filter(a => a.id !== annId));
    try {
      await deleteAnnotation(annId);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="bg-white rounded-xl p-6 card-shadow">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Email Design Comparison</h2>
        <p className="text-sm text-gray-500 mb-4">
          Side-by-side comparison of the client's email and an ECD benchmark. Click on each email to annotate strengths and weaknesses.
        </p>

        {emailLibrary.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">ECD Benchmark Example</label>
            <Select value={selectedEcdId || '__none__'} onValueChange={v => handleSelectEcd(v === '__none__' ? '' : v)} disabled={saving}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Select an example..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__"><SelectItemText>Select an example...</SelectItemText></SelectItem>
                {emailLibrary.map(e => (
                  <SelectItem key={e.id} value={e.id}><SelectItemText>{e.name} ({e.industry})</SelectItemText></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex justify-end mb-3">
          <button
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-primary bg-brand-primary/5 rounded-lg hover:bg-brand-primary/10 transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Full-screen compare
          </button>
        </div>

        <EmailDesignGrid
          emailDesign={emailDesign}
          ecdExample={ecdExample}
          sectionAnns={sectionAnns}
          handleAddAnnotation={handleAddAnnotation}
          handleRemoveAnnotation={handleRemoveAnnotation}
          markerSize={globalAnnotationSize}
          alwaysShowLabels={globalAnnotationsExpanded}
        />
      </div>

      {section && onSectionUpdate && (
        <div className="bg-white rounded-xl p-6 card-shadow">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Section Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Revenue Opportunity ($/mo)
              </label>
              <input
                type="number"
                value={section.revenue_opportunity}
                onChange={e => onSectionUpdate({ revenue_opportunity: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Confidence
              </label>
              <Select value={section.confidence} onValueChange={v => onSectionUpdate({ confidence: v as AuditSection['confidence'] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONFIDENCE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}><SelectItemText>{label}</SelectItemText></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Status
              </label>
              <div className="flex items-center gap-2">
                {(['draft', 'approved'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => onSectionUpdate({ status: s })}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      section.status === s
                        ? s === 'approved'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-600 text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {section.status === s && <Check className="w-3 h-3" />}
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-[#f7f7f8] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-white/95 backdrop-blur border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Email Design Comparison</h3>
            <button
              onClick={() => setFullscreen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
          <div className="p-6 pb-24 max-w-screen-2xl mx-auto">
            <div className="bg-white rounded-xl card-shadow p-6">
              <EmailDesignGrid
                emailDesign={emailDesign}
                ecdExample={ecdExample}
                sectionAnns={sectionAnns}
                handleAddAnnotation={handleAddAnnotation}
                handleRemoveAnnotation={handleRemoveAnnotation}
                maxHeight={typeof window !== 'undefined' ? window.innerHeight - 120 : 900}
                markerSize={globalAnnotationSize}
                alwaysShowLabels={globalAnnotationsExpanded}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailDesignGrid({
  emailDesign,
  ecdExample,
  sectionAnns,
  handleAddAnnotation,
  handleRemoveAnnotation,
  maxHeight,
  markerSize = 'md',
  alwaysShowLabels = false,
}: {
  emailDesign: AuditEmailDesign | null;
  ecdExample: IndustryEmailLibrary | null;
  sectionAnns: Annotation[];
  handleAddAnnotation: (side: 'current' | 'optimized', x: number, y: number, label: string) => void;
  handleRemoveAnnotation: (id: string) => void;
  maxHeight?: number;
  markerSize?: 'sm' | 'md' | 'lg';
  alwaysShowLabels?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-0">
      <div className="min-w-0 space-y-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <h4 className="text-sm font-semibold text-gray-800">
            Client's Email
            {emailDesign?.client_campaign_name && (
              <span className="ml-1 text-xs font-normal text-gray-400">({emailDesign.client_campaign_name})</span>
            )}
          </h4>
        </div>
        {emailDesign?.client_email_html ? (
          <AnnotationLayer
            htmlContent={emailDesign.client_email_html}
            annotations={sectionAnns}
            onAddAnnotation={(x, y, label) => handleAddAnnotation('current', x, y, label)}
            onRemoveAnnotation={handleRemoveAnnotation}
            editable
            side="current"
            markerSize={markerSize}
            alwaysShowLabels={alwaysShowLabels}
            {...(maxHeight ? { maxHeight } : {})}
          />
        ) : (
          <div className="aspect-[9/16] max-h-[600px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <div className="text-center">
              <Mail className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No client email fetched</p>
              <p className="text-xs text-gray-300 mt-1">The client's most recent campaign email will appear here after running the audit</p>
            </div>
          </div>
        )}
      </div>

      <div className="hidden lg:block bg-gray-200 w-px" />

      <div className="min-w-0 space-y-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h4 className="text-sm font-semibold text-gray-800">ECD Benchmark</h4>
        </div>
        {ecdExample ? (
          <AnnotationLayer
            imageUrl={ecdExample.content_type === 'image' ? (ecdExample.image_url ?? undefined) : undefined}
            htmlContent={ecdExample.content_type === 'html' ? (ecdExample.html_content ?? undefined) : undefined}
            annotations={sectionAnns}
            onAddAnnotation={(x, y, label) => handleAddAnnotation('optimized', x, y, label)}
            onRemoveAnnotation={handleRemoveAnnotation}
            editable
            side="optimized"
            markerSize={markerSize}
            alwaysShowLabels={alwaysShowLabels}
            {...(maxHeight ? { maxHeight } : {})}
          />
        ) : (
          <div className="aspect-[9/16] max-h-[600px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center px-6">
            <div className="text-center">
              <Palette className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No benchmark selected</p>
              <p className="text-xs text-gray-300 mt-1">Select an ECD example above or add one in Admin &gt; Email Library</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
