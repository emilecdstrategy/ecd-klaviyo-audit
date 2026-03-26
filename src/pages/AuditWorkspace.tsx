import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, BarChart3, LayoutGrid as Layout, Target, Mail, Palette, FormInput, DollarSign, ExternalLink } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditSectionEditor from '../components/audit/AuditSectionEditor';
import RevenueOpportunityCard from '../components/ui/RevenueOpportunityCard';
import ShareLinkPanel from '../components/ui/ShareLinkPanel';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  DEMO_AUDITS,
  DEMO_CLIENTS,
  DEMO_AUDIT_SECTIONS,
  DEMO_ASSETS,
  DEMO_ANNOTATIONS,
} from '../lib/demo-data';
import { SECTION_KEYS, SECTION_LABELS } from '../lib/constants';
import { formatCurrency } from '../lib/revenue-calculator';
import type { AuditSection, Annotation } from '../lib/types';
import type { Audit, AuditAsset, Client } from '../lib/types';
import { createAnnotation, deleteAnnotation, getAudit, getClient, listAnnotationsForAuditSections, listAssets, listAuditSections, publishAudit, updateAuditSection } from '../lib/db';

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
  const { isDemo } = useAuth();

  const [audit, setAudit] = useState<Audit | null>(isDemo ? (DEMO_AUDITS.find(a => a.id === id) ?? null) : null);
  const [client, setClient] = useState<Client | null>(
    isDemo && audit ? (DEMO_CLIENTS.find(c => c.id === audit.client_id) ?? null) : null,
  );
  const [assets, setAssets] = useState<AuditAsset[]>(isDemo ? DEMO_ASSETS.filter(a => a.audit_id === id) : []);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');

  const [sections, setSections] = useState<AuditSection[]>(
    isDemo ? DEMO_AUDIT_SECTIONS.filter(s => s.audit_id === id) : [],
  );
  const [annotations, setAnnotations] = useState<Annotation[]>(
    isDemo ? DEMO_ANNOTATIONS : [],
  );
  const [activeSection, setActiveSection] = useState<string>(SECTION_KEYS[0]);

  const saveTimers = useRef<Record<string, number>>({});
  const [publishBlockedReason, setPublishBlockedReason] = useState<string>('');

  // Hooks must run unconditionally on every render.
  // Compute derived values before any early returns to avoid hook-order crashes.
  const totalRevenue = useMemo(
    () => sections.reduce((sum, sec) => sum + (Number(sec.revenue_opportunity) || 0), 0),
    [sections],
  );
  const currentSection = sections.find(s => s.section_key === activeSection);

  useEffect(() => {
    let cancelled = false;
    if (isDemo || !id) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const a = await getAudit(id);
        if (!a) throw new Error('Audit not found');
        const c = await getClient(a.client_id);
        const [secs, as] = await Promise.all([listAuditSections(id), listAssets(id)]);
        const anns = await listAnnotationsForAuditSections(secs.map(s => s.id));
        if (cancelled) return;
        setAudit(a);
        setClient(c);
        setSections(secs);
        setAssets(as);
        setAnnotations(anns);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isDemo]);

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

  if (loading) {
    return (
      <div>
        <TopBar title="Audit" />
        <div className="p-8 text-sm text-gray-500">Loading audit...</div>
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

  const handleSectionUpdate = (sectionId: string, updates: Partial<AuditSection>) => {
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, ...updates } : s)));
    if (isDemo) return;
    if (saveTimers.current[sectionId]) window.clearTimeout(saveTimers.current[sectionId]);
    saveTimers.current[sectionId] = window.setTimeout(async () => {
      try {
        await updateAuditSection(sectionId, updates);
      } catch {
        // keep UI responsive; errors surface on next reload
      }
    }, 400);
  };

  const handleAddAnnotation = async (side: 'current' | 'optimized', x: number, y: number, label: string) => {
    if (!currentSection) return;
    const asset = assets.find(a => a.section_key === currentSection.section_key && a.side === side);
    if (isDemo) {
      const newAnnotation: Annotation = {
        id: `ann-${Date.now()}`,
        audit_section_id: currentSection.id,
        asset_id: asset?.id || '',
        x_position: x,
        y_position: y,
        label,
        side,
        created_at: new Date().toISOString(),
      };
      setAnnotations(prev => [...prev, newAnnotation]);
      return;
    }
    try {
      const created = await createAnnotation({
        audit_section_id: currentSection.id,
        asset_id: asset?.id || '',
        x_position: x,
        y_position: y,
        label,
        side,
      });
      setAnnotations(prev => [...prev, created]);
    } catch {
      // ignore for now
    }
  };

  const handleRemoveAnnotation = async (annId: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== annId));
    if (isDemo) return;
    try {
      await deleteAnnotation(annId);
    } catch {
      // ignore for now
    }
  };

  const handlePublish = async () => {
    if (isDemo || !audit) return;
    try {
      const updated = await publishAudit(audit.id);
      setAudit(updated);
      setPublishBlockedReason('');
    } catch {
      // expose actionable message in UI
      setPublishBlockedReason('Can’t publish yet. Please re-run the snapshot so performance data is available.');
    }
  };

  return (
    <div>
      <TopBar
        title={audit.title}
        subtitle={client?.company_name}
        actions={
          audit.public_share_token ? (
            <button
              onClick={() => navigate(`/report/${audit.public_share_token}`)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View Report
            </button>
          ) : undefined
        }
      />

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
              <StatusBadge status={audit.status} size="md" />
            </div>
            <RevenueOpportunityCard amount={totalRevenue} compact />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeSection === 'revenue_summary' ? (
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

              {audit.executive_summary && (
                <div className="bg-white rounded-xl p-6 card-shadow">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Executive Summary</h3>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                    {audit.executive_summary}
                  </p>
                </div>
              )}
            </div>
          ) : currentSection ? (
            <AuditSectionEditor
              section={currentSection}
              assets={assets}
              annotations={annotations}
              onUpdate={updates => handleSectionUpdate(currentSection.id, updates)}
              onAddAnnotation={handleAddAnnotation}
              onRemoveAnnotation={handleRemoveAnnotation}
            />
          ) : (
            <div className="bg-white rounded-xl p-8 card-shadow text-center">
              <p className="text-sm text-gray-500">
                No data for this section yet. Run AI analysis to generate findings.
              </p>
            </div>
          )}
        </div>

        <div className="hidden xl:block w-[360px] 2xl:w-[420px] bg-white border-l border-gray-100 p-4 overflow-y-auto shrink-0 space-y-4">
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
                <span className="font-medium text-gray-800 capitalize">{audit.audit_method}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">List Size</span>
                <span className="font-medium text-gray-800">{audit.list_size.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">AOV</span>
                <span className="font-medium text-gray-800">{formatCurrency(audit.aov)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Traffic</span>
                <span className="font-medium text-gray-800">{audit.monthly_traffic.toLocaleString()}/mo</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
