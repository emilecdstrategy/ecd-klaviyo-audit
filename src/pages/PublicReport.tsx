import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Zap, TrendingUp, AlertTriangle, CheckCircle2, BarChart3, ChevronRight } from 'lucide-react';
import {
  DEMO_AUDITS,
  DEMO_CLIENTS,
  DEMO_AUDIT_SECTIONS,
  DEMO_ASSETS,
  DEMO_ANNOTATIONS,
  DEMO_FLOW_PERFORMANCE,
  DEMO_HEALTH_SCORES,
  DEMO_RECOMMENDATIONS,
} from '../lib/demo-data';
import { SECTION_LABELS } from '../lib/constants';
import { formatCurrency } from '../lib/revenue-calculator';
import AnnotationLayer from '../components/audit/AnnotationLayer';
import ReportFlowTable from '../components/report/ReportFlowTable';
import ReportFlowInventoryTable from '../components/report/ReportFlowInventoryTable';
import ReportFlowStats from '../components/report/ReportFlowStats';
import ReportFlowHealthScore from '../components/report/ReportFlowHealthScore';
import ReportFlowRevenueBreakdown from '../components/report/ReportFlowRevenueBreakdown';
import ReportHealthScore from '../components/report/ReportHealthScore';
import ReportSegmentTable from '../components/report/ReportSegmentTable';
import ReportFormTable from '../components/report/ReportFormTable';
import ReportCampaignTable from '../components/report/ReportCampaignTable';
import ReportRecommendations from '../components/report/ReportRecommendations';
import { RichAuditText } from '../components/ui/RichAuditText';
import type { AuditSection } from '../lib/types';
import { getPublicReportByToken } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { id: 'summary', label: 'Summary' },
  { id: 'health', label: 'Health Score' },
  { id: 'flows', label: 'Flows' },
  { id: 'segments', label: 'Segments' },
  { id: 'forms', label: 'Signup Forms' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'findings', label: 'Findings' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'opportunity', label: 'Revenue' },
];

export default function PublicReport() {
  const { token } = useParams();
  const { isDemo } = useAuth();
  const [activeSection, setActiveSection] = useState('summary');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const [loading, setLoading] = useState(!isDemo);
  const [loadError, setLoadError] = useState('');

  const [audit, setAudit] = useState(() => DEMO_AUDITS.find(a => a.public_share_token === token) ?? null);
  const [client, setClient] = useState(() => (audit ? (DEMO_CLIENTS.find(c => c.id === audit.client_id) ?? null) : null));
  const [sections, setSections] = useState(() => (audit ? DEMO_AUDIT_SECTIONS.filter(s => s.audit_id === audit.id) : []));
  const [assets, setAssets] = useState(() => (audit ? DEMO_ASSETS.filter(a => a.audit_id === audit.id) : []));
  const [annotations, setAnnotations] = useState(() => DEMO_ANNOTATIONS);
  const [flowPerformance, setFlowPerformance] = useState(() => (audit ? DEMO_FLOW_PERFORMANCE.filter(f => f.audit_id === audit.id) : []));
  const [flowSnapshots, setFlowSnapshots] = useState<any[]>([]);
  const [segmentSnapshots, setSegmentSnapshots] = useState<any[]>([]);
  const [formSnapshots, setFormSnapshots] = useState<any[]>([]);
  const [campaignSnapshots, setCampaignSnapshots] = useState<any[]>([]);
  const [healthScores, setHealthScores] = useState(() => DEMO_HEALTH_SCORES);
  const [recommendations, setRecommendations] = useState(() => (audit ? DEMO_RECOMMENDATIONS.filter(r => r.audit_id === audit.id) : []));
  const [reportingDiagnostic, setReportingDiagnostic] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) return;
    if (!token) return;
    (async () => {
      try {
        setLoading(true);
        setLoadError('');
        const report = await getPublicReportByToken(token);
        if (cancelled) return;
        if (!report) {
          setAudit(null);
          setClient(null);
          setSections([]);
          setAssets([]);
          setAnnotations([]);
          setFlowPerformance([]);
          setFlowSnapshots([]);
          setSegmentSnapshots([]);
          setFormSnapshots([]);
          setCampaignSnapshots([]);
          setHealthScores([]);
          setRecommendations([]);
          setReportingDiagnostic(null);
          return;
        }
        setAudit(report.audit);
        setClient(report.client);
        setSections(report.sections);
        setAssets(report.assets);
        setAnnotations(report.annotations);
        setFlowPerformance(report.flowPerformance);
        setFlowSnapshots(report.flowSnapshots ?? []);
        setSegmentSnapshots(report.segmentSnapshots ?? []);
        setFormSnapshots(report.formSnapshots ?? []);
        setCampaignSnapshots(report.campaignSnapshots ?? []);
        setHealthScores(report.healthScores);
        setRecommendations(report.recommendations);
        setReportingDiagnostic(report.reportingDiagnostic ?? null);
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, token]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    NAV_ITEMS.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { rootMargin: '-20% 0px -70% 0px' },
      );
      observer.observe(el);
      observers.push(observer);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [audit]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">Loading report...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Couldn’t load report</h1>
          <p className="text-gray-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!audit || !client) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Report Not Found</h1>
          <p className="text-gray-500">This report link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const totalRevenue = sections.reduce((s, sec) => s + sec.revenue_opportunity, 0);
  const currentFlowMonthlyRevenue = flowPerformance.reduce((s, f) => s + (f.monthly_revenue_current ?? 0), 0);
  const topOpportunities = [...sections]
    .filter(s => s.revenue_opportunity > 0)
    .sort((a, b) => b.revenue_opportunity - a.revenue_opportunity);
  const reportSections = sections.filter(s => s.section_key !== 'revenue_summary');

  let execText = audit.executive_summary || '';
  let aiStrengths: string[] = [];
  let aiConcerns: string[] = [];
  let aiTimeline: { phase: string; timeframe: string; label: string; items: string[] }[] = [];
  try {
    const parsed = JSON.parse(execText);
    if (parsed && typeof parsed.text === 'string') {
      execText = parsed.text;
      aiStrengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
      aiConcerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
      aiTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
    }
  } catch {
    // plain text — keep as-is
  }

  const visibleNavItems = NAV_ITEMS.filter(n => {
    if (n.id === 'recommendations' && !audit.show_recommendations) return false;
    if (n.id === 'flows' && flowSnapshots.length === 0 && flowPerformance.length === 0) return false;
    if (n.id === 'segments' && segmentSnapshots.length === 0) return false;
    if (n.id === 'forms' && formSnapshots.length === 0) return false;
    if (n.id === 'campaigns' && campaignSnapshots.length === 0) return false;
    if (n.id === 'health' && healthScores.length === 0) return false;
    return true;
  });

  const setRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  return (
    <div className="min-h-screen bg-[#f9f9f9]">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-gray-900">ECD</span>
              <span className="text-xs text-gray-400 block -mt-0.5 leading-none">Email Audit Report</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">Prepared for</p>
            <p className="text-sm font-semibold text-gray-900">{client.company_name}</p>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-40">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex overflow-x-auto">
            {visibleNavItems.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setActiveSection(item.id)}
                className={`px-4 py-3.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeSection === item.id
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-16">
        <section id="summary" ref={setRef('summary')}>
          <SectionHeader number="01" label="Executive Summary" />

          <div className="bg-white rounded-2xl p-8 border border-gray-100 mb-6">
            <p className="text-xs font-semibold text-brand-primary uppercase tracking-widest mb-3">
              Klaviyo Email Audit — {client.company_name}
            </p>
            <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900 leading-tight mb-5">
              {client.company_name} could unlock{' '}
              <span className="text-brand-primary">{formatCurrency(totalRevenue)}/month</span>{' '}
              in additional email revenue.
            </h1>
            <RichAuditText text={execText?.split('\n')[0] || ''} className="text-base text-gray-600 leading-relaxed" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPIBlock label="Total Opportunity" value={formatCurrency(totalRevenue)} sub="per month" subColor="text-emerald-600" />
            <KPIBlock label="Sections Audited" value={String(reportSections.length)} sub="areas reviewed" />
            <KPIBlock label="Total Flows" value={String(flowSnapshots.length)} sub={`${flowSnapshots.filter((f: any) => (f.status || '').toLowerCase() === 'live').length} live`} />
            <KPIBlock label="Total Campaigns" value={String(campaignSnapshots.length)} sub={`${segmentSnapshots.length} segments`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-900">What's Working</h3>
              </div>
              <ul className="space-y-3">
                {aiStrengths.length > 0 ? aiStrengths.map((s, i) => {
                  const dashIdx = s.indexOf(' — ');
                  const bold = dashIdx > 0 ? s.slice(0, dashIdx) : s;
                  const rest = dashIdx > 0 ? s.slice(dashIdx + 3) : '';
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-emerald-500 mt-0.5 shrink-0">→</span>
                      <span>
                        <span className="font-semibold block">{bold}</span>
                        {rest && <RichAuditText text={rest} className="block text-gray-600 leading-relaxed mt-0.5" />}
                      </span>
                    </li>
                  );
                }) : (
                  <li className="text-sm text-gray-500">AI overview not available for this audit run.</li>
                )}
              </ul>
            </div>
            <div className="bg-white rounded-xl p-5 border border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-semibold text-gray-900">What Needs Attention</h3>
              </div>
              <ul className="space-y-3">
                {aiConcerns.length > 0 ? aiConcerns.map((s, i) => {
                  const dashIdx = s.indexOf(' — ');
                  const bold = dashIdx > 0 ? s.slice(0, dashIdx) : s;
                  const rest = dashIdx > 0 ? s.slice(dashIdx + 3) : '';
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-red-400 mt-0.5 shrink-0">→</span>
                      <span>
                        <span className="font-semibold block">{bold}</span>
                        {rest && <RichAuditText text={rest} className="block text-gray-600 leading-relaxed mt-0.5" />}
                      </span>
                    </li>
                  );
                }) : (
                  <li className="text-sm text-gray-500">AI overview not available for this audit run.</li>
                )}
              </ul>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Top 3 Opportunities</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topOpportunities.slice(0, 3).map((s, i) => (
                <div key={s.id} className="bg-white rounded-xl p-5 border border-gray-100 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-brand-primary rounded-l-xl" />
                  <div className="pl-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-white bg-brand-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-gray-900">{SECTION_LABELS[s.section_key]}</span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-700 mb-1">
                      {formatCurrency(s.revenue_opportunity)}<span className="text-sm font-medium text-emerald-600">/mo</span>
                    </p>
                    <RichAuditText text={s.summary_text || ''} className="text-xs text-gray-500 leading-relaxed line-clamp-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {healthScores.length > 0 && (
          <section id="health" ref={setRef('health')}>
            <SectionHeader number="02" label="Account Health Score" />
            <ReportHealthScore scores={healthScores} />
          </section>
        )}

        {(flowSnapshots.length > 0 || flowPerformance.length > 0) && (
          <section id="flows" ref={setRef('flows')}>
            <SectionHeader number="03" label="Flows" />

            {(flowSnapshots.length > 0 || flowPerformance.length > 0) && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6 p-6">
                <ReportFlowStats
                  snapshots={flowSnapshots as any}
                  performance={flowPerformance}
                  clientName={client.company_name}
                  reportingDiagnostic={reportingDiagnostic}
                />
              </div>
            )}

            {flowPerformance.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6 p-6">
                <ReportFlowHealthScore
                  snapshots={flowSnapshots as any}
                  performance={flowPerformance}
                  segmentCount={segmentSnapshots.length}
                />
              </div>
            )}

            {flowPerformance.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6 p-6">
                <ReportFlowRevenueBreakdown performance={flowPerformance} />
              </div>
            )}

            {flowPerformance.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-gray-50">
                  <h3 className="text-lg font-bold text-gray-900">Flow Performance Details</h3>
                </div>
                <div className="p-6">
                  <ReportFlowTable flows={flowPerformance} snapshots={flowSnapshots as any} />
                </div>
              </div>
            )}

            {flowSnapshots.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-50">
                  <h3 className="text-lg font-bold text-gray-900">Full Flow Inventory</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    All flows pulled from Klaviyo ({flowSnapshots.length} total).
                  </p>
                </div>
                <div className="p-6">
                  <ReportFlowInventoryTable flows={flowSnapshots as any} />
                </div>
              </div>
            )}
          </section>
        )}

        {segmentSnapshots.length > 0 && (
          <section id="segments" ref={setRef('segments')}>
            <SectionHeader number="04" label="Segments" />
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50">
                <p className="text-sm text-gray-500">
                  Inventory of segments pulled directly from Klaviyo for this audit.
                </p>
              </div>
              <div className="p-6">
                <ReportSegmentTable segments={segmentSnapshots as any} />
              </div>
            </div>
          </section>
        )}

        {formSnapshots.length > 0 && (
          <section id="forms" ref={setRef('forms')}>
            <SectionHeader number="05" label="Signup Forms" />
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50">
                <p className="text-sm text-gray-500">
                  Inventory of signup forms pulled directly from Klaviyo for this audit.
                </p>
              </div>
              <div className="p-6">
                <ReportFormTable forms={formSnapshots as any} />
              </div>
            </div>
          </section>
        )}

        {campaignSnapshots.length > 0 && (
          <section id="campaigns" ref={setRef('campaigns')}>
            <SectionHeader number="06" label="Campaigns" />
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50">
                <p className="text-sm text-gray-500">
                  Inventory of campaigns pulled directly from Klaviyo for this audit.
                </p>
              </div>
              <div className="p-6">
                <ReportCampaignTable campaigns={campaignSnapshots as any} />
              </div>
            </div>
          </section>
        )}

        <section id="findings" ref={setRef('findings')}>
          <SectionHeader number="07" label="Section-by-Section Findings" />
          <div className="space-y-6">
            {reportSections.map((section, index) => (
              <ReportSectionBlock
                key={section.id}
                section={section}
                index={index}
                assets={assets}
                annotations={annotations}
              />
            ))}
          </div>
        </section>

        {audit.show_recommendations && recommendations.length > 0 && (
          <section id="recommendations" ref={setRef('recommendations')}>
            <SectionHeader number="08" label="Priority Action Plan" />
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50">
                <p className="text-sm text-gray-500">
                  Organized by implementation effort and expected impact. Start with Quick Wins for immediate results.
                </p>
              </div>
              <div className="p-6">
                <ReportRecommendations recommendations={recommendations} />
              </div>
            </div>
          </section>
        )}

        <section id="opportunity" ref={setRef('opportunity')}>
          <SectionHeader number="09" label="Revenue Opportunity" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
            <div className="bg-white rounded-xl p-6 border border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Current Email Revenue</p>
              <p className="text-3xl font-bold text-gray-400 mb-1">
                {currentFlowMonthlyRevenue > 0 ? formatCurrency(currentFlowMonthlyRevenue) : 'N/A'}<span className="text-base font-normal">{currentFlowMonthlyRevenue > 0 ? '/mo' : ''}</span>
              </p>
              <p className="text-xs text-gray-400">
                {currentFlowMonthlyRevenue > 0 ? 'Based on Klaviyo flow reporting data' : 'Not available for this audit (missing metrics scope)'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-brand-primary/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-primary/5 rounded-bl-full" />
              <p className="text-xs font-semibold text-brand-primary uppercase tracking-wider mb-2">Potential Email Revenue</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {formatCurrency((currentFlowMonthlyRevenue > 0 ? currentFlowMonthlyRevenue : 0) + totalRevenue)}<span className="text-base font-normal text-gray-500">/mo</span>
              </p>
              <p className="text-xs text-emerald-600 font-medium">+{formatCurrency(totalRevenue)}/mo identified opportunity</p>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-gray-100 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">Breakdown by Area</h3>
            <div className="space-y-4">
              {topOpportunities.map(s => {
                const pct = totalRevenue > 0 ? (s.revenue_opportunity / totalRevenue) * 100 : 0;
                return (
                  <div key={s.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-700">{SECTION_LABELS[s.section_key]}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{Math.round(pct)}%</span>
                        <span className="text-sm font-semibold text-gray-900 w-20 text-right">
                          {formatCurrency(s.revenue_opportunity)}/mo
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 border border-gray-100 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-6">Implementation Timeline</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
              <div className="hidden md:block absolute top-5 left-[12.5%] right-[12.5%] h-px bg-gray-100 z-0" />
              {(aiTimeline.length >= 4 ? aiTimeline : []).map((p, i) => {
                const colors = ['bg-emerald-500', 'bg-brand-primary', 'bg-amber-500', 'bg-gray-300'];
                return (
                  <div key={i} className="relative flex flex-col items-center text-center px-2">
                    <div className={`w-10 h-10 rounded-full ${colors[i] ?? 'bg-gray-300'} flex items-center justify-center text-white text-xs font-bold mb-3 z-10 relative`}>
                      {i + 1}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{p.phase}</p>
                    <p className="text-xs text-gray-400 mb-1">{p.timeframe}</p>
                    <p className="text-sm font-semibold text-gray-900 mb-3">{p.label}</p>
                    <ul className="space-y-1 text-left w-full">
                      {p.items.map((item, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs text-gray-500">
                          <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-gray-300" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {aiTimeline.length < 4 && (
                <p className="text-sm text-gray-500 md:col-span-4 text-center py-6">
                  AI timeline not available for this audit run.
                </p>
              )}
            </div>
          </div>

          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <BarChart3 className="w-8 h-8 text-white/20 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Total Identified Opportunity</h2>
            <p className="text-5xl font-extrabold text-white mb-1">
              {formatCurrency(totalRevenue)}
              <span className="text-xl font-medium text-white/40">/month</span>
            </p>
            <p className="text-sm text-white/40 mb-7">in additional email-attributed revenue</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-xl mx-auto mb-8">
              {topOpportunities.map(s => (
                <div key={s.id} className="bg-white/5 rounded-lg p-3 text-left border border-white/10">
                  <p className="text-[11px] text-white/40 mb-0.5">{SECTION_LABELS[s.section_key]}</p>
                  <p className="text-base font-bold text-white">{formatCurrency(s.revenue_opportunity)}</p>
                </div>
              ))}
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 max-w-2xl mx-auto">
              <p className="text-xs text-white/30 leading-relaxed">
                Revenue estimates are based on industry benchmarks and the account-specific metrics provided. Actual results depend on
                execution quality, seasonality, offer strength, and list health. These figures represent potential opportunity, not guaranteed outcomes.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-gray-100 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-brand-primary flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-gray-900">ECD</span>
              <span className="text-xs text-gray-400 block -mt-0.5 leading-none">Email Conversion Design</span>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Report prepared {audit.published_at ? new Date(audit.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'recently'}
          </p>
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-[11px] font-bold text-gray-300 tabular-nums">{number}</span>
      <div className="w-px h-4 bg-gray-200" />
      <h2 className="text-lg font-bold text-gray-900">{label}</h2>
    </div>
  );
}

function KPIBlock({ label, value, sub, subColor = 'text-gray-400' }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className={`text-xs font-medium mt-0.5 ${subColor}`}>{sub}</p>
    </div>
  );
}

function parseSectionDetails(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function SectionRubricDetails({ section }: { section: AuditSection }) {
  const details = parseSectionDetails((section as any).section_details);
  if (!details) return null;

  if (section.section_key === 'flows') {
    const rows = details?.flows?.core_flows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 overflow-x-auto">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Core Flows Matrix</p>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="text-left py-1.5 pr-2">Flow</th><th className="text-left py-1.5 pr-2">Present</th><th className="text-left py-1.5 pr-2">Live</th><th className="text-left py-1.5 pr-2">Emails</th><th className="text-left py-1.5 pr-2">Current</th><th className="text-left py-1.5">Recommended</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i} className="border-t border-gray-100 text-gray-700 align-top">
                <td className="py-2 pr-2 font-medium">{r.flow_name}</td>
                <td className="py-2 pr-2">{r.present ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-2">{r.live ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-2">{typeof r.email_count === 'number' ? r.email_count : 'N/A'}</td>
                <td className="py-2 pr-2">{r.current_structure_note || 'N/A'}</td>
                <td className="py-2">{r.recommended_structure || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (section.section_key === 'segmentation') {
    const d = details?.segmentation;
    if (!d) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 text-sm text-gray-700 space-y-1.5">
        <p><strong>Full-list sends:</strong> {d.sends_to_full_list ? 'Yes' : 'No'}</p>
        <p><strong>Engaged/unengaged segments:</strong> {d.has_engaged_unengaged_segments ? 'Defined' : 'Missing'}</p>
        <p><strong>VIP/high-LTV segments:</strong> {d.has_vip_segments ? 'Defined' : 'Missing'}</p>
        <p><strong>ECD benchmark:</strong> {d.benchmark_architecture_note || 'N/A'}</p>
      </div>
    );
  }

  if (section.section_key === 'campaigns') {
    const d = details?.campaigns;
    if (!d) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 text-sm text-gray-700 space-y-1.5">
        <p><strong>Cadence:</strong> {d.send_frequency_consistency || 'N/A'}</p>
        <p><strong>Targeting quality:</strong> {d.segmented_vs_blast_note || 'N/A'}</p>
        <p><strong>Subject/preview hygiene:</strong> {d.subject_preview_hygiene_note || 'N/A'}</p>
        <p><strong>Type mix:</strong> {d.campaign_type_mix_note || 'N/A'}</p>
      </div>
    );
  }

  if (section.section_key === 'signup_forms') {
    const d = details?.signup_forms;
    if (!d) return null;
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 text-sm text-gray-700 space-y-1.5">
        <p><strong>Popup:</strong> {d.has_popup ? 'Present' : 'Missing'}</p>
        <p><strong>Embedded form:</strong> {d.has_embedded_form ? 'Present' : 'Missing'}</p>
        <p><strong>Offer quality:</strong> {d.offer_note || 'N/A'}</p>
        <p><strong>Mobile optimization:</strong> {d.mobile_optimization_note || 'N/A'}</p>
        <p><strong>Benchmark conversion:</strong> {d.benchmark_conversion_note || 'N/A'}</p>
      </div>
    );
  }

  return null;
}

function ReportSectionBlock({
  section,
  index,
  assets,
  annotations,
}: {
  section: AuditSection;
  index: number;
  assets: typeof DEMO_ASSETS;
  annotations: typeof DEMO_ANNOTATIONS;
}) {
  const currentAsset = assets.find(a => a.section_key === section.section_key && a.side === 'current');
  const optimizedAsset = assets.find(a => a.section_key === section.section_key && a.side === 'optimized');
  const sectionAnnotations = annotations.filter(a => a.audit_section_id === section.id);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-50 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-gray-300 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
          <h3 className="text-base font-bold text-gray-900">{SECTION_LABELS[section.section_key]}</h3>
        </div>
        {section.revenue_opportunity > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-700">{formatCurrency(section.revenue_opportunity)}/mo</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              section.confidence === 'high' ? 'bg-emerald-50 text-emerald-600' :
              section.confidence === 'medium' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {section.confidence} confidence
            </span>
          </div>
        )}
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{section.current_state_title || 'Current State'}</h4>
            </div>
            <div className="bg-red-50/40 border border-red-100 rounded-xl p-4 mb-4">
              <RichAuditText text={section.current_state_notes || ''} className="text-sm text-gray-700 leading-relaxed" />
            </div>
            {currentAsset && (
              <AnnotationLayer
                imageUrl={currentAsset.file_url}
                annotations={sectionAnnotations}
                editable={false}
                side="current"
              />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{section.optimized_state_title || 'Optimized State'}</h4>
            </div>
            <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-4 mb-4">
              <RichAuditText text={section.optimized_notes || ''} className="text-sm text-gray-700 leading-relaxed" />
            </div>
            {optimizedAsset && (
              <AnnotationLayer
                imageUrl={optimizedAsset.file_url}
                annotations={sectionAnnotations}
                editable={false}
                side="optimized"
              />
            )}
          </div>
        </div>
        <SectionRubricDetails section={section} />

        {(section.human_edited_findings || section.summary_text) && (
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Key Takeaway</p>
            <RichAuditText text={section.human_edited_findings || section.summary_text || ''} className="text-sm text-gray-700 leading-relaxed" />
          </div>
        )}
      </div>
    </div>
  );
}
