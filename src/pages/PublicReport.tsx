import { useState, useEffect, useLayoutEffect, useRef, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { TrendingUp, AlertTriangle, CheckCircle2, ChevronRight, Maximize2, X, LayoutDashboard, BarChart3, Activity, CalendarDays } from 'lucide-react';
import { SECTION_LABELS } from '../lib/constants';
import { formatCurrency } from '../lib/revenue-calculator';
import AnnotationLayer from '../components/audit/AnnotationLayer';
import ReportFlowTable from '../components/report/ReportFlowTable';
import ReportFlowInventoryTable from '../components/report/ReportFlowInventoryTable';
import ReportFlowHealthScore from '../components/report/ReportFlowHealthScore';
import ReportFlowRevenueBreakdown from '../components/report/ReportFlowRevenueBreakdown';
import ReportHealthScore from '../components/report/ReportHealthScore';
import ReportAccountSnapshot from '../components/report/ReportAccountSnapshot';
import ReportSegmentTable from '../components/report/ReportSegmentTable';
import ReportFormTable from '../components/report/ReportFormTable';
import ReportCampaignTable from '../components/report/ReportCampaignTable';
import ReportInventoryLauncher from '../components/report/ReportInventoryLauncher';
import ReportCoreFlowsMatrix from '../components/report/ReportCoreFlowsMatrix';
import ReportCover from '../components/report/ReportCover';
import ReportSectionHeader from '../components/report/ReportSectionHeader';
import ReportKeyFindings from '../components/report/ReportKeyFindings';
import ReportStrengthsPanel from '../components/report/ReportStrengthsPanel';
import ReportTrustFooter from '../components/report/ReportTrustFooter';
import ReportBlockHeader from '../components/report/ReportBlockHeader';
import { RichAuditText } from '../components/ui/RichAuditText';
import type { AuditSection, AuditAsset, Annotation, AuditEmailDesign, RevenueOpportunityAddOnItem } from '../lib/types';
import { getPublicReportByToken, getPlatformSettings } from '../lib/db';
import { resolveExecutiveFindings } from '../lib/findings-normalize';
import { cn } from '../lib/utils';
import {
  extractAccountHealthRawConfig,
  extractCampaignsRawConfig,
  extractEmailDesignRawConfig,
  extractExecutiveSummaryRawConfig,
  extractFlowsRawConfig,
  extractSegmentationRawConfig,
  extractSignupFormsRawConfig,
  isAccountHealthBlockVisible,
  isCampaignsBlockVisible,
  isEmailDesignBlockVisible,
  isExecutiveSummaryBlockVisible,
  isFlowsBlockVisible,
  isSegmentationBlockVisible,
  isSignupFormsBlockVisible,
  resolveAccountHealthConfig,
  resolveCampaignsConfig,
  resolveEmailDesignConfig,
  resolveExecutiveSummaryConfig,
  resolveFlowsConfig,
  resolveRevenueSummaryConfig,
  resolveSegmentationConfig,
  resolveSignupFormsConfig,
} from '../lib/report-config/resolve';
import { DEFAULT_REVENUE_SUMMARY_SECTION } from '../lib/report-config/defaults';
import type { RevenueSummarySectionConfig } from '../lib/report-config/types';

const NAV_ITEMS = [
  { id: 'summary', label: 'Summary' },
  { id: 'health', label: 'Health Score' },
  { id: 'flows', label: 'Flows' },
  { id: 'segments', label: 'Segments' },
  { id: 'forms', label: 'Signup Forms' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'email_design', label: 'Email Design' },
  { id: 'opportunity', label: 'Revenue Opportunity' },
];

export default function PublicReport() {
  const { token } = useParams();
  const [activeSection, setActiveSection] = useState('summary');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [audit, setAudit] = useState<any | null>(null);
  const [client, setClient] = useState<any | null>(null);
  const [sections, setSections] = useState<AuditSection[]>([]);
  const [assets, setAssets] = useState<AuditAsset[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [flowPerformance, setFlowPerformance] = useState<any[]>([]);
  const [flowSnapshots, setFlowSnapshots] = useState<any[]>([]);
  const [segmentSnapshots, setSegmentSnapshots] = useState<any[]>([]);
  const [formSnapshots, setFormSnapshots] = useState<any[]>([]);
  const [campaignSnapshots, setCampaignSnapshots] = useState<any[]>([]);
  const [healthScores, setHealthScores] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [emailDesign, setEmailDesign] = useState<AuditEmailDesign | null>(null);
  const [reportingDiagnostic, setReportingDiagnostic] = useState<string | null>(null);
  const [accountSnapshot, setAccountSnapshot] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
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
          setEmailDesign(null);
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
        setEmailDesign(report.emailDesign ?? null);
        setReportingDiagnostic(report.reportingDiagnostic ?? null);
        setAccountSnapshot((report as any).accountSnapshot ?? null);
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (client?.company_name) {
      document.title = `Klaviyo Email Audit — ${client.company_name}`;
    }
    return () => { document.title = 'ECD Audit Dashboard'; };
  }, [client?.company_name]);

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

  const entityNames = useMemo(() => {
    const names = new Set<string>();
    for (const f of flowSnapshots) if (f.name) names.add(f.name);
    for (const f of flowPerformance) if (f.flow_name) names.add(f.flow_name);
    for (const s of segmentSnapshots) if (s.name) names.add(s.name);
    for (const f of formSnapshots) if (f.name) names.add(f.name);
    for (const c of campaignSnapshots) if (c.name) names.add(c.name);
    return Array.from(names);
  }, [flowSnapshots, flowPerformance, segmentSnapshots, formSnapshots, campaignSnapshots]);

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

  const isPreview = audit.status === 'draft' || audit.status === 'in_review';

  const currentFlowMonthlyRevenue = flowPerformance.reduce((s, f) => s + (f.monthly_revenue_current ?? 0), 0);
  const topOpportunities = [...sections]
    .filter(s => s.revenue_opportunity > 0)
    .sort((a, b) => b.revenue_opportunity - a.revenue_opportunity);
  const reportSections = sections.filter(s => s.section_key !== 'revenue_summary' && s.status !== 'draft');

  let execText = audit.executive_summary || '';
  let aiFindings: string[] = [];
  let aiStrengths: string[] = [];
  let aiConcerns: string[] = [];
  let aiTimeline: { phase: string; timeframe: string; label: string; items: string[] }[] = [];
  try {
    const parsed = JSON.parse(execText);
    if (parsed && typeof parsed.text === 'string') {
      execText = parsed.text;
      aiFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
      aiStrengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
      aiConcerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
      aiTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
    }
  } catch {
    // plain text — keep as-is
  }
  aiFindings = resolveExecutiveFindings(aiFindings, aiConcerns);

  const stripInlineBoldMarkers = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

  const pickConfig = (key: string) =>
    (reportSections.find(s => s.section_key === key)?.section_config as Record<string, unknown> | null | undefined) ?? null;

  const flowsSectionRow = reportSections.find(s => s.section_key === 'flows');
  const flowsCfg = resolveFlowsConfig(extractFlowsRawConfig(pickConfig('flows')));

  const accountHealthCfg = resolveAccountHealthConfig(
    extractAccountHealthRawConfig(pickConfig('account_health')),
  );

  const segmentationSectionRow = reportSections.find(s => s.section_key === 'segmentation');
  const segmentationCfg = resolveSegmentationConfig(
    extractSegmentationRawConfig(pickConfig('segmentation')),
  );

  const signupFormsSectionRow = reportSections.find(s => s.section_key === 'signup_forms');
  const signupFormsCfg = resolveSignupFormsConfig(
    extractSignupFormsRawConfig(pickConfig('signup_forms')),
  );

  const campaignsSectionRow = reportSections.find(s => s.section_key === 'campaigns');
  const campaignsCfg = resolveCampaignsConfig(
    extractCampaignsRawConfig(pickConfig('campaigns')),
  );

  const emailDesignCfg = resolveEmailDesignConfig(
    extractEmailDesignRawConfig(pickConfig('email_design')),
  );

  const auditLayout = (audit.layout as Record<string, unknown> | null | undefined) ?? {};
  const revenueSummaryRaw = auditLayout.revenue_summary as Partial<RevenueSummarySectionConfig> | null | undefined;
  const revenueSummaryCfg = resolveRevenueSummaryConfig(
    revenueSummaryRaw && typeof revenueSummaryRaw === 'object' ? revenueSummaryRaw : undefined,
  );
  const addOnItemsRaw = revenueSummaryCfg.blocks.addOns?.items;
  const visibleAddOnItems: RevenueOpportunityAddOnItem[] = Array.isArray(addOnItemsRaw)
    ? addOnItemsRaw
      .filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object')
      .map((item, index) => ({
        ...item,
        bullets: Array.isArray(item.bullets) ? item.bullets.map(v => String(v)) : [],
        revenue_monthly: Number(item.revenue_monthly ?? 0),
        display_order: typeof item.display_order === 'number' ? item.display_order : (index + 1) * 10,
        is_hidden: Boolean(item.is_hidden),
      }))
      .filter(item => !item.is_hidden)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    : [];
  const addOnRevenue = visibleAddOnItems.reduce((sum, item) => sum + (Number(item.revenue_monthly) || 0), 0);
  const totalRevenue = sections.reduce((s, sec) => s + sec.revenue_opportunity, 0) + addOnRevenue;

  const executiveSummaryCfg = resolveExecutiveSummaryConfig(
    extractExecutiveSummaryRawConfig(auditLayout),
  );

  const flowsDataAvailable = flowSnapshots.length > 0 || flowPerformance.length > 0;
  const flowsSectionVisible = flowsDataAvailable && !flowsCfg.hidden;
  const healthSectionVisible = healthScores.length > 0 && !accountHealthCfg.hidden;
  const segmentsSectionVisible = segmentSnapshots.length > 0 && !segmentationCfg.hidden;
  const formsSectionVisible = formSnapshots.length > 0 && !signupFormsCfg.hidden;
  const campaignsSectionVisible = campaignSnapshots.length > 0 && !campaignsCfg.hidden;
  const emailDesignSectionVisible =
    Boolean(emailDesign?.client_email_html || emailDesign?.ecd_example) && !emailDesignCfg.hidden;
  const opportunitySectionVisible = !revenueSummaryCfg.hidden;
  const summarySectionVisible = !executiveSummaryCfg.hidden;

  const sectionVisibility: Record<string, boolean> = {
    summary: summarySectionVisible,
    health: healthSectionVisible,
    flows: flowsSectionVisible,
    segments: segmentsSectionVisible,
    forms: formsSectionVisible,
    campaigns: campaignsSectionVisible,
    email_design: emailDesignSectionVisible,
    opportunity: opportunitySectionVisible,
  };

  const sectionNumbers: Record<string, string> = {};
  {
    let n = 1;
    for (const item of NAV_ITEMS) {
      if (!sectionVisibility[item.id]) continue;
      sectionNumbers[item.id] = String(n).padStart(2, '0');
      n += 1;
    }
  }

  const visibleNavItems = NAV_ITEMS.filter(n => sectionVisibility[n.id]);

  const setRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  const preparedDateLabel = audit.published_at
    ? new Date(audit.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : audit.created_at
      ? new Date(audit.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'recently';

  return (
    <div className="min-h-screen bg-brand-surface">
      {isPreview && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-center">
          <span className="text-sm font-medium text-amber-800">Preview Mode — This report is not published yet and is only visible to team members.</span>
        </div>
      )}

      <div className="sticky top-0 z-40 border-b border-gray-100 bg-white">
        <div className="max-w-[90rem] mx-auto px-6">
          <nav className="flex overflow-x-auto">
            {visibleNavItems.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection(item.id);
                  const el = sectionRefs.current[item.id] ?? document.getElementById(item.id);
                  if (!el) return;
                  const headerOffset = isPreview ? 90 : 52;
                  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                  window.scrollTo({ top, behavior: 'smooth' });
                }}
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

      <main className="max-w-[90rem] mx-auto px-6 py-10 space-y-16">
        {summarySectionVisible && (
        <section id="summary" ref={setRef('summary')}>
          <ReportCover companyName={client.company_name} preparedDate={preparedDateLabel} />

            <ReportSectionHeader
            number={sectionNumbers['summary'] ?? executiveSummaryCfg.sectionNumber ?? '01'}
            label={executiveSummaryCfg.sectionTitle ?? 'Executive Summary'}
          />

          {isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'findings') && aiFindings.length > 0 && (
            <ReportKeyFindings
              title={executiveSummaryCfg.blocks.findings?.title ?? 'Key Findings'}
              findings={aiFindings}
            />
          )}

          {isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'hero') && (() => {
            const hero = executiveSummaryCfg.blocks.hero;
            const eyebrow = hero?.eyebrow;
            const headline = hero?.headline;
            const intro = hero?.intro;
            const defaultHeadline = `Klaviyo audit overview for ${client.company_name}`;
            const defaultIntro = toOneOrTwoSentences(execText?.split('\n')[0] || '');
            const showHeadline = headline !== null;
            const showIntro = intro !== null;
            if (!showHeadline && !showIntro && !eyebrow && eyebrow !== undefined) return null;
            if (!showHeadline && !showIntro && eyebrow === undefined && !defaultIntro) return null;
            return (
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                {eyebrow !== null && (
                  <p className="text-xs font-semibold text-brand-primary uppercase tracking-widest mb-3">
                    {eyebrow ?? `Klaviyo Email Audit — ${client.company_name}`}
                  </p>
                )}
                {showHeadline && (
                  <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900 leading-tight mb-5">
                    {typeof headline === 'string' && headline.length > 0 ? headline : defaultHeadline}
                  </h1>
                )}
                {showIntro && (
                  <RichAuditText
                    text={typeof intro === 'string' && intro.length > 0 ? intro : defaultIntro}
                    className="text-base text-gray-600 leading-relaxed"
                  />
                )}
              </div>
            );
          })()}

          {isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'accountSnapshot') &&
            (flowSnapshots.length > 0 || campaignSnapshots.length > 0) && (
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <ReportBlockHeader
                  icon={
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                      <LayoutDashboard className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                    </div>
                  }
                  title={executiveSummaryCfg.blocks.accountSnapshot?.title ?? 'Account Snapshot'}
                  subtitle="Live metrics pulled from Klaviyo at the time of this audit"
                />
                <div className="p-6">
                  <ReportAccountSnapshot
                  flowSnapshots={flowSnapshots as any}
                  flowPerformance={flowPerformance}
                  campaignSnapshots={campaignSnapshots as any}
                  reportingDiagnostic={reportingDiagnostic}
                  accountSnapshot={accountSnapshot}
                />
                </div>
              </div>
            )}

          {isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'strengths') && (
            <ReportStrengthsPanel
              title={executiveSummaryCfg.blocks.strengths?.title ?? "What's Working"}
              strengths={aiStrengths}
            />
          )}

        </section>
        )}

        {healthSectionVisible && (
          <section id="health" ref={setRef('health')}>
            <ReportSectionHeader
              number={sectionNumbers['health'] ?? accountHealthCfg.sectionNumber ?? '02'}
              label={accountHealthCfg.sectionTitle ?? 'Account Health Score'}
            />
            {isAccountHealthBlockVisible(accountHealthCfg, 'healthScoreTable') && (
              <ReportHealthScore scores={healthScores} />
            )}
          </section>
        )}

        {flowsSectionVisible && (
          <section id="flows" ref={setRef('flows')}>
            <ReportSectionHeader
              number={sectionNumbers['flows'] ?? flowsCfg.sectionNumber ?? '03'}
              label={flowsCfg.sectionTitle ?? 'Flows'}
            />

            {(isFlowsBlockVisible(flowsCfg, 'narrative') || isFlowsBlockVisible(flowsCfg, 'rubric')) && (() => {
              const flowsSection = flowsSectionRow;
              const idx = flowsSection ? reportSections.findIndex(s => s.id === flowsSection.id) : -1;
              if (!flowsSection) return null;
              const narrativeCfg = flowsCfg.blocks.narrative;
              const narrativeVisible = isFlowsBlockVisible(flowsCfg, 'narrative');
              const rubricVisible = isFlowsBlockVisible(flowsCfg, 'rubric');
              const sectionForBlock: AuditSection = {
                ...flowsSection,
                current_state_title: narrativeCfg?.currentTitle ?? flowsSection.current_state_title,
                optimized_state_title: narrativeCfg?.optimizedTitle ?? flowsSection.optimized_state_title,
              };
              return (
                <div className="mb-6">
                  <ReportSectionBlock
                    section={sectionForBlock}
                    index={idx < 0 ? 0 : idx}
                    assets={assets}
                    annotations={annotations}
                    hideHeader
                    hideCurrentOptimized={!narrativeVisible}
                    hideRubric={!rubricVisible}
                    hideKeyTakeaway
                    entityNames={entityNames}
                  />
                </div>
              );
            })()}

            {isFlowsBlockVisible(flowsCfg, 'healthScore') && flowPerformance.length > 0 && (
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <ReportFlowHealthScore
                  snapshots={flowSnapshots as any}
                  performance={flowPerformance}
                  segmentCount={segmentSnapshots.length}
                  title={flowsCfg.blocks.healthScore?.title}
                  subtitle={flowsCfg.blocks.healthScore?.subtitle}
                  benchmarks={flowsCfg.blocks.healthScore?.benchmarks}
                />
              </div>
            )}

            {isFlowsBlockVisible(flowsCfg, 'revenueBreakdown') && flowPerformance.length > 0 && (
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <ReportFlowRevenueBreakdown
                  performance={flowPerformance}
                  title={flowsCfg.blocks.revenueBreakdown?.title}
                  insights={flowsCfg.blocks.revenueBreakdown?.insights}
                />
              </div>
            )}

            {isFlowsBlockVisible(flowsCfg, 'flowTable') && flowPerformance.length > 0 && (
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <ReportBlockHeader
                  icon={
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                      <Activity className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                    </div>
                  }
                  title={flowsCfg.blocks.flowTable?.title ?? 'Flow Performance Details'}
                />
                <div className="p-6">
                  <ReportFlowTable
                    flows={flowPerformance}
                    snapshots={flowSnapshots as any}
                    defaultVisibleRows={flowsCfg.blocks.flowTable?.defaultVisibleRows}
                    subtitleOverride={flowsCfg.blocks.flowTable?.subtitleOverride}
                  />
                </div>
              </div>
            )}

            {isFlowsBlockVisible(flowsCfg, 'inventoryTable') && (
              <ReportInventoryLauncher
                title={flowsCfg.blocks.inventoryTable?.title ?? 'Full Flow Inventory'}
                count={flowSnapshots.filter((f: { is_hidden?: boolean }) => !f.is_hidden).length}
                countLabel="flows"
                modalTitle={flowsCfg.blocks.inventoryTable?.title ?? 'Full Flow Inventory'}
                modalSubtitle="Complete inventory of flows pulled directly from Klaviyo for this audit."
              >
                <ReportFlowInventoryTable flows={flowSnapshots as any} scrollable />
              </ReportInventoryLauncher>
            )}
          </section>
        )}

        {segmentsSectionVisible && (
          <section id="segments" ref={setRef('segments')}>
            <ReportSectionHeader
              number={sectionNumbers['segments'] ?? segmentationCfg.sectionNumber ?? '04'}
              label={segmentationCfg.sectionTitle ?? 'Segments'}
            />

            {(isSegmentationBlockVisible(segmentationCfg, 'narrative') ||
              isSegmentationBlockVisible(segmentationCfg, 'rubric')) && segmentationSectionRow && (() => {
              const segSection = segmentationSectionRow;
              const idx = reportSections.findIndex(s => s.id === segSection.id);
              const narrativeCfg = segmentationCfg.blocks.narrative;
              const narrativeVisible = isSegmentationBlockVisible(segmentationCfg, 'narrative');
              const rubricVisible = isSegmentationBlockVisible(segmentationCfg, 'rubric');
              const sectionForBlock: AuditSection = {
                ...segSection,
                current_state_title: narrativeCfg?.currentTitle ?? segSection.current_state_title,
                optimized_state_title: narrativeCfg?.optimizedTitle ?? segSection.optimized_state_title,
              };
              return (
                <div className="mb-6">
                  <ReportSectionBlock
                    section={sectionForBlock}
                    index={idx < 0 ? 0 : idx}
                    assets={assets}
                    annotations={annotations}
                    hideHeader
                    hideCurrentOptimized={!narrativeVisible}
                    hideRubric={!rubricVisible}
                    hideKeyTakeaway={!narrativeVisible}
                    entityNames={entityNames}
                  />
                </div>
              );
            })()}

            {isSegmentationBlockVisible(segmentationCfg, 'segmentTable') && (
              <ReportInventoryLauncher
                title={segmentationCfg.blocks.segmentTable?.title ?? 'Segment inventory'}
                subtitle={segmentationCfg.blocks.segmentTable?.subtitle}
                count={segmentSnapshots.filter((s: { is_hidden?: boolean }) => !s.is_hidden).length}
                countLabel="segments"
                modalTitle={segmentationCfg.blocks.segmentTable?.title ?? 'Segment inventory'}
                modalSubtitle="Inventory of segments pulled directly from Klaviyo for this audit."
              >
                <ReportSegmentTable segments={segmentSnapshots as any} scrollable />
              </ReportInventoryLauncher>
            )}
          </section>
        )}

        {formsSectionVisible && (
          <section id="forms" ref={setRef('forms')}>
            <ReportSectionHeader
              number={sectionNumbers['forms'] ?? signupFormsCfg.sectionNumber ?? '05'}
              label={signupFormsCfg.sectionTitle ?? 'Signup Forms'}
            />

            {(isSignupFormsBlockVisible(signupFormsCfg, 'narrative') ||
              isSignupFormsBlockVisible(signupFormsCfg, 'rubric')) && signupFormsSectionRow && (() => {
              const formsSection = signupFormsSectionRow;
              const idx = reportSections.findIndex(s => s.id === formsSection.id);
              const narrativeCfg = signupFormsCfg.blocks.narrative;
              const narrativeVisible = isSignupFormsBlockVisible(signupFormsCfg, 'narrative');
              const rubricVisible = isSignupFormsBlockVisible(signupFormsCfg, 'rubric');
              const sectionForBlock: AuditSection = {
                ...formsSection,
                current_state_title: narrativeCfg?.currentTitle ?? formsSection.current_state_title,
                optimized_state_title: narrativeCfg?.optimizedTitle ?? formsSection.optimized_state_title,
              };
              return (
                <div className="mb-6">
                  <ReportSectionBlock
                    section={sectionForBlock}
                    index={idx < 0 ? 0 : idx}
                    assets={assets}
                    annotations={annotations}
                    hideHeader
                    hideCurrentOptimized={!narrativeVisible}
                    hideRubric={!rubricVisible}
                    hideKeyTakeaway={!narrativeVisible}
                    entityNames={entityNames}
                  />
                </div>
              );
            })()}

            {isSignupFormsBlockVisible(signupFormsCfg, 'formTable') && (
              <ReportInventoryLauncher
                title={signupFormsCfg.blocks.formTable?.title ?? 'Signup form inventory'}
                subtitle={signupFormsCfg.blocks.formTable?.subtitle}
                count={formSnapshots.filter((f: { is_hidden?: boolean }) => !f.is_hidden).length}
                countLabel="forms"
                modalTitle={signupFormsCfg.blocks.formTable?.title ?? 'Signup form inventory'}
                modalSubtitle="Inventory of signup forms pulled directly from Klaviyo for this audit."
              >
                <ReportFormTable forms={formSnapshots as any} scrollable />
              </ReportInventoryLauncher>
            )}
          </section>
        )}

        {campaignsSectionVisible && (
          <section id="campaigns" ref={setRef('campaigns')}>
            <ReportSectionHeader
              number={sectionNumbers['campaigns'] ?? campaignsCfg.sectionNumber ?? '06'}
              label={campaignsCfg.sectionTitle ?? 'Campaigns'}
            />

            {(isCampaignsBlockVisible(campaignsCfg, 'narrative') ||
              isCampaignsBlockVisible(campaignsCfg, 'rubric')) && campaignsSectionRow && (() => {
              const campSection = campaignsSectionRow;
              const idx = reportSections.findIndex(s => s.id === campSection.id);
              const narrativeCfg = campaignsCfg.blocks.narrative;
              const narrativeVisible = isCampaignsBlockVisible(campaignsCfg, 'narrative');
              const rubricVisible = isCampaignsBlockVisible(campaignsCfg, 'rubric');
              const sectionForBlock: AuditSection = {
                ...campSection,
                current_state_title: narrativeCfg?.currentTitle ?? campSection.current_state_title,
                optimized_state_title: narrativeCfg?.optimizedTitle ?? campSection.optimized_state_title,
              };
              return (
                <div className="mb-6">
                  <ReportSectionBlock
                    section={sectionForBlock}
                    index={idx < 0 ? 0 : idx}
                    assets={assets}
                    annotations={annotations}
                    hideHeader
                    hideCurrentOptimized={!narrativeVisible}
                    hideRubric={!rubricVisible}
                    hideKeyTakeaway={!narrativeVisible}
                    entityNames={entityNames}
                  />
                </div>
              );
            })()}

            {isCampaignsBlockVisible(campaignsCfg, 'campaignTable') && (
              <ReportInventoryLauncher
                title={campaignsCfg.blocks.campaignTable?.title ?? 'Campaign inventory'}
                subtitle={campaignsCfg.blocks.campaignTable?.subtitle}
                count={campaignSnapshots.filter((c: { is_hidden?: boolean }) => !c.is_hidden).length}
                countLabel="campaigns"
                modalTitle={campaignsCfg.blocks.campaignTable?.title ?? 'Campaign inventory'}
                modalSubtitle="Inventory of campaigns pulled directly from Klaviyo for this audit."
              >
                <ReportCampaignTable campaigns={campaignSnapshots as any} scrollable />
              </ReportInventoryLauncher>
            )}
          </section>
        )}

        {emailDesignSectionVisible && emailDesign && isEmailDesignBlockVisible(emailDesignCfg, 'comparison') && (
          <section id="email_design" ref={setRef('email_design')}>
            <ReportSectionHeader
              number={sectionNumbers['email_design'] ?? emailDesignCfg.sectionNumber ?? '07'}
              label={emailDesignCfg.sectionTitle ?? 'Email Design'}
            />
            <EmailDesignSection
              emailDesign={emailDesign}
              annotations={annotations}
              sections={reportSections}
              subtitleOverride={emailDesignCfg.blocks.comparison?.subtitle}
            />
          </section>
        )}

        {opportunitySectionVisible && (
        <section id="opportunity" ref={setRef('opportunity')}>
          <ReportSectionHeader
            number={sectionNumbers['opportunity'] ?? revenueSummaryCfg.sectionNumber ?? '08'}
            label={revenueSummaryCfg.sectionTitle ?? 'Revenue Opportunity'}
          />

          {revenueSummaryCfg.blocks.metrics && revenueSummaryCfg.blocks.metrics.hidden !== true && (
          <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Current Email Revenue</p>
              <p className="text-3xl font-bold text-gray-400 mb-1">
                {currentFlowMonthlyRevenue > 0 ? formatCurrency(currentFlowMonthlyRevenue) : 'N/A'}<span className="text-base font-normal">{currentFlowMonthlyRevenue > 0 ? '/mo' : ''}</span>
              </p>
              <p className="text-xs text-gray-400">
                {currentFlowMonthlyRevenue > 0 ? 'Based on Klaviyo flow reporting data' : 'Not available for this audit (missing metrics scope)'}
              </p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-brand-primary/20 bg-white p-6 shadow-sm">
              <div className="absolute top-0 right-0 w-24 h-24 bg-brand-primary/5 rounded-bl-full" />
              <p className="text-xs font-semibold text-brand-primary uppercase tracking-wider mb-2">Potential Email Revenue</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {formatCurrency((currentFlowMonthlyRevenue > 0 ? currentFlowMonthlyRevenue : 0) + totalRevenue)}<span className="text-base font-normal text-gray-500">/mo</span>
              </p>
              <p className="text-xs text-emerald-600 font-medium">+{formatCurrency(totalRevenue)}/mo identified opportunity</p>
            </div>
          </div>
          )}

          {/* Breakdown by Area hidden */}

          {revenueSummaryCfg.blocks.addOns && revenueSummaryCfg.blocks.addOns.hidden !== true && visibleAddOnItems.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <ReportBlockHeader
              icon={
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                  <BarChart3 className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                </div>
              }
              title={revenueSummaryCfg.blocks.addOns.title ?? 'Recommended Klaviyo Add-Ons'}
              subtitle={(revenueSummaryCfg.blocks.addOns.subtitle ?? '').trim() || undefined}
            />
            <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleAddOnItems.map((item) => (
                <div key={`${item.template_slug}-${item.display_order}`} className="rounded-xl border border-gray-100 p-5 bg-gray-50/40">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{item.name}</h4>
                      {item.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-emerald-700 tabular-nums">
                        {formatCurrency(item.revenue_monthly || 0)}
                      </p>
                      <p className="text-[11px] text-emerald-600">/mo</p>
                    </div>
                  </div>
                  {item.bullets.length > 0 && (
                    <ul className="list-disc pl-5 space-y-2 marker:text-brand-primary">
                      {item.bullets.map((bullet, idx) => (
                        <li key={`${item.template_slug}-bullet-${idx}`} className="text-sm leading-relaxed text-gray-700">
                          <RichAuditText text={bullet} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            </div>
          </div>
          )}

          {revenueSummaryCfg.blocks.totalBanner && revenueSummaryCfg.blocks.totalBanner.hidden !== true && (
          <div className="relative overflow-hidden rounded-3xl text-center shadow-xl shadow-brand-primary/20 ring-1 ring-white/20">
            <div
              className="absolute inset-0 bg-gradient-to-br from-brand-primary-dark via-brand-primary to-brand-primary-light"
              aria-hidden
            />
            <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-white/25 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-brand-primary-dark/40 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(255,255,255,0.18),transparent)]" aria-hidden />

            <div className="relative px-6 py-10 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/30 backdrop-blur-sm">
                <TrendingUp className="h-7 w-7 text-white" strokeWidth={2.25} />
              </div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">Revenue opportunity</p>
              <h2 className="mb-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {revenueSummaryCfg.blocks.totalBanner?.title ?? 'Total identified opportunity'}
              </h2>
              <div className="mb-2 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0">
                <span className="text-4xl font-extrabold tabular-nums tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-6xl">
                  {formatCurrency(totalRevenue)}
                </span>
                <span className="text-lg font-semibold text-white/80 sm:text-xl">/month</span>
              </div>
              <p className="mb-10 text-sm font-medium text-white/75">
                {revenueSummaryCfg.blocks.totalBanner?.subtitle ?? 'Additional email-attributed revenue identified in this audit'}
              </p>

              {topOpportunities.length > 0 && (
                <div className="mx-auto mb-10 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {topOpportunities.map(s => (
                    <div
                      key={s.id}
                      className="group rounded-2xl border border-white/20 bg-white/10 p-4 text-left shadow-lg shadow-black/10 backdrop-blur-md transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/15"
                    >
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                        {SECTION_LABELS[s.section_key]}
                      </p>
                      <p className="text-xl font-bold tabular-nums text-white sm:text-2xl">
                        {formatCurrency(s.revenue_opportunity)}
                      </p>
                      <p className="mt-0.5 text-xs text-white/50">per month</p>
                    </div>
                  ))}
                </div>
              )}

              {revenueSummaryCfg.blocks.totalBanner?.disclaimer !== null && (
                <div className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-black/10 px-5 py-4 backdrop-blur-sm">
                  <p className="text-sm leading-relaxed text-white/80">
                    {revenueSummaryCfg.blocks.totalBanner?.disclaimer ?? DEFAULT_REVENUE_SUMMARY_SECTION.blocks.totalBanner?.disclaimer}
                  </p>
                </div>
              )}
            </div>
          </div>
          )}

          {revenueSummaryCfg.blocks.timeline && revenueSummaryCfg.blocks.timeline.hidden !== true && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <ReportBlockHeader
              icon={
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                  <CalendarDays className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                </div>
              }
              title={revenueSummaryCfg.blocks.timeline?.title ?? 'Implementation Timeline'}
              subtitle={revenueSummaryCfg.blocks.timeline?.subtitle ?? 'Suggested rollout order — work through each phase before moving to the next.'}
            />
            <div className="p-6">
            {aiTimeline.length > 0 ? (
              <div className="space-y-8">
                {aiTimeline.slice(0, 4).map((p, i) => (
                  <ImplementationTimelinePhase key={i} phase={p} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600 text-center py-8">AI timeline not available for this audit run.</p>
            )}
            </div>
          </div>
          )}
        </section>
        )}
      </main>

      <ReportTrustFooter preparedDate={preparedDateLabel} />
    </div>
  );
}

function toOneOrTwoSentences(text: string) {
  const t = (text ?? '').trim();
  if (!t) return '';
  const normalized = t.replace(/\s+/g, ' ');
  const parts = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

function parseSectionDetails(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function renderInlineMarkdownBold(text: string) {
  const src = String(text ?? '');
  const parts = src.split('\n');
  return (
    <>
      {parts.map((line, lineIdx) => {
        const nodes: React.ReactNode[] = [];
        const regex = /\*\*(.+?)\*\*/g;
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          if (match.index > last) nodes.push(line.slice(last, match.index));
          nodes.push(<strong key={`${lineIdx}-${match.index}-${match[1]}`}>{match[1]}</strong>);
          last = regex.lastIndex;
        }
        if (last < line.length) nodes.push(line.slice(last));

        return (
          <span key={`line-${lineIdx}`}>
            {nodes}
            {lineIdx < parts.length - 1 ? <br /> : null}
          </span>
        );
      })}
    </>
  );
}

const snapshotDotTone = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  neutral: 'bg-gray-400',
} as const;

/** Compact status line (dot + label) for snapshot grids — avoids full-width stretched pills. */
function SnapshotStatusValue({ tone, children }: { children: ReactNode; tone: keyof typeof snapshotDotTone }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', snapshotDotTone[tone])} aria-hidden />
      <span className="text-sm font-semibold leading-snug text-gray-900">{children}</span>
    </div>
  );
}

function RubricExpandableNote({ text, collapsedLines = 4 }: { text: string; collapsedLines?: 3 | 4 | 5 }) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const raw = String(text ?? '').trim();
  const collapsedPx = collapsedLines === 3 ? 72 : collapsedLines === 5 ? 120 : 96;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !raw || raw === 'N/A') {
      setNeedsToggle(false);
      return;
    }
    if (expanded) return;
    const measure = () => {
      if (!contentRef.current) return;
      setNeedsToggle(contentRef.current.scrollHeight > contentRef.current.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [raw, expanded, collapsedLines]);

  const expandedHeight = contentRef.current?.scrollHeight ?? collapsedPx;

  if (!raw || raw === 'N/A') {
    return <p className="text-sm text-gray-400">N/A</p>;
  }

  return (
    <div>
      <div
        ref={contentRef}
        style={{ maxHeight: expanded ? expandedHeight : collapsedPx }}
        className={cn(
          'text-sm text-gray-700 leading-relaxed [&_strong]:text-gray-900 [&_strong]:font-semibold overflow-hidden',
          needsToggle && 'transition-[max-height] duration-300 ease-in-out motion-reduce:transition-none',
        )}
      >
        {renderInlineMarkdownBold(raw)}
      </div>
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-2.5 text-xs font-semibold text-brand-primary transition-colors duration-200 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function RubricInsightCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
      <div className="gradient-bg px-5 py-2.5">
        <p className="text-[13px] font-bold uppercase tracking-wider text-white text-center">{label}</p>
      </div>
      <div className="px-5 pt-4 pb-5">
        {children}
      </div>
    </div>
  );
}

const TIMELINE_ACCENT = ['bg-emerald-500', 'bg-brand-primary', 'bg-amber-500', 'bg-slate-400'] as const;

function ImplementationTimelinePhase({
  phase,
  index,
}: {
  phase: { phase: string; timeframe: string; label: string; items: string[] };
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Array.isArray(phase.items) ? phase.items : [];
  const previewCount = 5;
  const many = items.length > previewCount;
  const visibleItems = !many || expanded ? items : items.slice(0, previewCount);
  const accent = TIMELINE_ACCENT[index] ?? 'bg-slate-400';

  return (
    <div className="flex gap-4 sm:gap-5">
      <div className="shrink-0">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ${accent}`}
        >
          {index + 1}
        </div>
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-gray-100 bg-white p-4 sm:p-5 card-shadow">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-primary">{phase.phase}</span>
          <span className="text-sm text-gray-600">{phase.timeframe}</span>
        </div>
        <div className="mb-4 text-base font-semibold leading-snug text-gray-900">
          {renderInlineMarkdownBold(phase.label || '')}
        </div>
        <ul className="space-y-3">
          {visibleItems.map((item, j) => (
            <li
              key={j}
              className={cn(
                'flex items-start gap-2.5 text-sm leading-relaxed text-gray-800',
                expanded && j >= previewCount && 'animate-slide-up motion-reduce:animate-none',
              )}
              style={
                expanded && j >= previewCount
                  ? { animationDelay: `${(j - previewCount) * 45}ms`, animationFillMode: 'backwards' }
                  : undefined
              }
            >
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary/70" aria-hidden />
              <span className="min-w-0 [&_strong]:font-semibold [&_strong]:text-gray-900">
                {renderInlineMarkdownBold(item)}
              </span>
            </li>
          ))}
        </ul>
        {many && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="mt-4 text-sm font-semibold text-brand-primary transition-colors duration-200 hover:underline"
          >
            {expanded ? 'Show fewer' : `Show ${items.length - previewCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function SectionRubricDetails({ section }: { section: AuditSection }) {
  const details = parseSectionDetails((section as any).section_details);
  if (!details) return null;

  if (section.section_key === 'flows') {
    const rows = details?.flows?.core_flows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return <ReportCoreFlowsMatrix rows={rows} />;
  }

  if (section.section_key === 'segmentation') {
    const d = details?.segmentation;
    if (!d) return null;
    const blastRisk = Boolean(d.sends_to_full_list);
    return (
      <div className="mb-4 space-y-3">
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
          <div className="gradient-bg px-5 py-2.5">
            <p className="text-[13px] font-bold uppercase tracking-wider text-white text-center">Segmentation snapshot</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            <div className="flex min-h-[88px] flex-col items-start gap-2 px-5 py-4">
              <span className="text-sm font-medium text-gray-700 leading-snug">Full-list sends</span>
              <SnapshotStatusValue tone={blastRisk ? 'warn' : 'good'}>
                {blastRisk ? 'Yes — risk' : 'No'}
              </SnapshotStatusValue>
            </div>
            <div className="flex min-h-[88px] flex-col items-start gap-2 px-5 py-4">
              <span className="text-sm font-medium text-gray-700 leading-snug">Engaged / unengaged</span>
              <SnapshotStatusValue tone={d.has_engaged_unengaged_segments ? 'good' : 'bad'}>
                {d.has_engaged_unengaged_segments ? 'Defined' : 'Missing'}
              </SnapshotStatusValue>
            </div>
            <div className="flex min-h-[88px] flex-col items-start gap-2 px-5 py-4">
              <span className="text-sm font-medium text-gray-700 leading-snug">VIP / high-LTV</span>
              <SnapshotStatusValue tone={d.has_vip_segments ? 'good' : 'warn'}>
                {d.has_vip_segments ? 'Defined' : 'Missing'}
              </SnapshotStatusValue>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 overflow-hidden card-shadow" style={{ backgroundColor: '#f9f9f9' }}>
          <div className="gradient-bg px-5 py-2.5">
            <p className="text-[13px] font-bold uppercase tracking-wider text-white text-center">ECD benchmark</p>
          </div>
          <div className="px-5 pt-4 pb-5">
            <RubricExpandableNote text={d.benchmark_architecture_note || 'N/A'} collapsedLines={4} />
          </div>
        </div>
      </div>
    );
  }

  if (section.section_key === 'campaigns') {
    const d = details?.campaigns;
    if (!d) return null;
    const items = [
      { label: 'Cadence', value: d.send_frequency_consistency },
      { label: 'Targeting quality', value: d.segmented_vs_blast_note },
      { label: 'Subject / preview hygiene', value: d.subject_preview_hygiene_note },
      { label: 'Campaign type mix', value: d.campaign_type_mix_note },
    ];
    return (
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map(({ label, value }) => (
          <RubricInsightCard key={label} label={label}>
            <RubricExpandableNote text={value || 'N/A'} collapsedLines={4} />
          </RubricInsightCard>
        ))}
      </div>
    );
  }

  if (section.section_key === 'signup_forms') {
    const d = details?.signup_forms;
    if (!d) return null;
    return (
      <div className="mb-4 space-y-3">
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
          <div className="gradient-bg px-5 py-2.5">
            <p className="text-[13px] font-bold uppercase tracking-wider text-white text-center">Form coverage</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            <div className="flex flex-col items-start gap-2 px-5 py-4">
              <span className="text-sm font-medium text-gray-700">Popup</span>
              <SnapshotStatusValue tone={d.has_popup ? 'good' : 'warn'}>
                {d.has_popup ? 'Present' : 'Missing'}
              </SnapshotStatusValue>
            </div>
            <div className="flex flex-col items-start gap-2 px-5 py-4">
              <span className="text-sm font-medium text-gray-700">Embedded form</span>
              <SnapshotStatusValue tone={d.has_embedded_form ? 'good' : 'warn'}>
                {d.has_embedded_form ? 'Present' : 'Missing'}
              </SnapshotStatusValue>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RubricInsightCard label="Offer quality">
            <RubricExpandableNote text={d.offer_note || 'N/A'} collapsedLines={4} />
          </RubricInsightCard>
          <RubricInsightCard label="Mobile optimization">
            <RubricExpandableNote text={d.mobile_optimization_note || 'N/A'} collapsedLines={4} />
          </RubricInsightCard>
          <RubricInsightCard label="Benchmark conversion">
            <RubricExpandableNote text={d.benchmark_conversion_note || 'N/A'} collapsedLines={4} />
          </RubricInsightCard>
        </div>
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
  hideHeader = false,
  hideCurrentOptimized = false,
  hideRubric = false,
  hideKeyTakeaway = false,
  entityNames,
}: {
  section: AuditSection;
  index: number;
  assets: AuditAsset[];
  annotations: Annotation[];
  hideHeader?: boolean;
  hideCurrentOptimized?: boolean;
  hideRubric?: boolean;
  hideKeyTakeaway?: boolean;
  entityNames?: string[];
}) {
  const currentAsset = assets.find(a => a.section_key === section.section_key && a.side === 'current');
  const optimizedAsset = assets.find(a => a.section_key === section.section_key && a.side === 'optimized');
  const sectionAnnotations = annotations.filter(a => a.audit_section_id === section.id);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      {!hideHeader && (
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
      )}

      <div className="p-6">
        {!hideCurrentOptimized && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide [&_strong]:font-semibold">
                  {renderInlineMarkdownBold(section.current_state_title || 'Current State')}
                </h4>
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
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide [&_strong]:font-semibold">
                  {renderInlineMarkdownBold(section.optimized_state_title || 'Optimized State')}
                </h4>
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
        )}
        {!hideRubric && <SectionRubricDetails section={section} />}

        {!hideKeyTakeaway && (section.human_edited_findings || section.summary_text) && (
          <div className="rounded-xl p-4 border border-gray-100" style={{ backgroundColor: '#f9f9f9' }}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Key Takeaway</p>
            <RichAuditText text={section.human_edited_findings || section.summary_text || ''} className="text-sm text-gray-700 leading-relaxed" boldFlowNames entityNames={entityNames} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmailDesignSection({ emailDesign, annotations, sections, subtitleOverride }: { emailDesign: AuditEmailDesign; annotations: import('../lib/types').Annotation[]; sections: AuditSection[]; subtitleOverride?: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {subtitleOverride ?? 'Side-by-side comparison of a recent campaign email and an ECD-designed benchmark for your industry.'}
        </p>
        <EmailDesignFullscreenBtn onClick={() => setFullscreen(true)} />
      </div>
      <div className="p-6">
        <EmailDesignComparison
          emailDesign={emailDesign}
          annotations={annotations}
          sections={sections}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
        />
      </div>
    </div>
  );
}

function EmailDesignFullscreenBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-primary bg-brand-primary/5 rounded-lg hover:bg-brand-primary/10 transition-colors shrink-0"
    >
      <Maximize2 className="w-4 h-4" />
      Full-screen compare
    </button>
  );
}

function EmailDesignComparison({
  emailDesign,
  annotations,
  sections,
  fullscreen,
  onFullscreenChange,
}: {
  emailDesign: AuditEmailDesign;
  annotations: import('../lib/types').Annotation[];
  sections: AuditSection[];
  fullscreen: boolean;
  onFullscreenChange: (open: boolean) => void;
}) {
  const [globalAnnotationSize, setGlobalAnnotationSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [globalAnnotationsExpanded, setGlobalAnnotationsExpanded] = useState(false);

  useEffect(() => {
    getPlatformSettings().then(s => {
      setGlobalAnnotationSize(s.annotation_size);
      setGlobalAnnotationsExpanded(s.annotations_expanded);
    }).catch(() => {});
  }, []);

  const edSection = sections.find(s => s.section_key === 'email_design');
  const sectionAnns = edSection ? annotations.filter(a => a.audit_section_id === edSection.id) : [];
  const ecdExample = emailDesign.ecd_example;

  const comparisonGrid = (maxH?: number) => (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-0">
      {emailDesign.client_email_html && (
        <div className="min-w-0 space-y-3 px-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <h4 className="text-sm font-semibold text-gray-800">
              Client's Email
              {emailDesign.client_campaign_name && (
                <span className="ml-1 text-xs font-normal text-gray-400">({emailDesign.client_campaign_name})</span>
              )}
            </h4>
          </div>
          <AnnotationLayer
            htmlContent={emailDesign.client_email_html}
            annotations={sectionAnns}
            editable={false}
            side="current"
            markerSize={globalAnnotationSize}
            alwaysShowLabels={globalAnnotationsExpanded}
            {...(maxH ? { maxHeight: maxH } : {})}
          />
        </div>
      )}

      <div className="hidden lg:block bg-gray-200 w-px" />

      {ecdExample && (
        <div className="min-w-0 space-y-3 px-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <h4 className="text-sm font-semibold text-gray-800">ECD Benchmark</h4>
          </div>
          <AnnotationLayer
            imageUrl={ecdExample.content_type === 'image' ? (ecdExample.image_url ?? undefined) : undefined}
            htmlContent={ecdExample.content_type === 'html' ? (ecdExample.html_content ?? undefined) : undefined}
            annotations={sectionAnns}
            editable={false}
            side="optimized"
            markerSize={globalAnnotationSize}
            alwaysShowLabels={globalAnnotationsExpanded}
            {...(maxH ? { maxHeight: maxH } : {})}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      {comparisonGrid()}

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-[#f7f7f8] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-white/95 backdrop-blur border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Email Design Comparison</h3>
            <button
              onClick={() => onFullscreenChange(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
          <div className="p-6 pb-8 max-w-screen-2xl mx-auto">
            <div className="bg-white rounded-xl card-shadow p-6">
              {comparisonGrid(Math.floor(window.innerHeight * 0.9 - 56))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
