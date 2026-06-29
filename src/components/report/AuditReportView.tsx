import { useState, useEffect, useLayoutEffect, useRef, useMemo, type ReactNode } from 'react';
import { TrendingUp, AlertTriangle, CheckCircle2, ChevronRight, Maximize2, X, LayoutDashboard, BarChart3, Activity, CalendarDays } from 'lucide-react';
import { SECTION_LABELS } from '../../lib/constants';
import { computeAuditTotalRevenueOpportunity, formatCurrency } from '../../lib/revenue-calculator';
import { resolveRevenueOpportunityContent } from '../../lib/revenue-opportunity-content';
import { normalizeCoreFlowsMatrix } from '../../lib/core-flows-matrix';
import AnnotationLayer from '../audit/AnnotationLayer';
import ReportFlowTable from './ReportFlowTable';
import ReportFlowInventoryTable from './ReportFlowInventoryTable';
import ReportFlowHealthScore from './ReportFlowHealthScore';
import ReportFlowRevenueBreakdown from './ReportFlowRevenueBreakdown';
import ReportDeliverabilitySnapshot from './ReportDeliverabilitySnapshot';
import ReportAccountSnapshot from './ReportAccountSnapshot';
import ReportSegmentTable from './ReportSegmentTable';
import ReportCampaignAudienceSegments from './ReportCampaignAudienceSegments';
import ReportFormTable from './ReportFormTable';
import ReportCampaignTable from './ReportCampaignTable';
import ReportInventoryLauncher from './ReportInventoryLauncher';
import ReportCoreFlowsMatrix from './ReportCoreFlowsMatrix';
import ReportCover from './ReportCover';
import ReportSectionHeader from './ReportSectionHeader';
import ReportKeyFindings from './ReportKeyFindings';
import ReportSectionKeyFindings from './ReportSectionKeyFindings';
import ReportStrengthsPanel from './ReportStrengthsPanel';
import ReportTrustFooter from './ReportTrustFooter';
import ReportBlockHeader from './ReportBlockHeader';
import EditableRichText from './edit/EditableRichText';
import EditablePlainText from './edit/EditablePlainText';
import EditableCurrency from './edit/EditableCurrency';
import { useReportEdit } from './edit/ReportEditContext';
import { ReportEntityProvider, useReportEntities } from './edit/ReportEntityContext';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';
import ReportBlockEditChrome, { ReportHiddenItemStub, ReportItemHideButton } from './edit/ReportBlockEditChrome';
import ReportSectionEditChrome, { emailDesignAction, revenueOpportunitiesAction } from './edit/ReportSectionEditChrome';
import { RichAuditText, renderInlineMarkdown } from '../ui/RichAuditText';
import ImageLightbox from '../ui/ImageLightbox';
import ImageUploadZone from '../ui/ImageUploadZone';
import ResizableReportImage from '../ui/ResizableReportImage';
import DemoPopupModal, { type DemoPopupState } from '../ui/DemoPopupModal';
import { resolveCustomerAgentDemoUrl } from '../../lib/customer-agent-demo';
import { addOnHasPricing, splitAddOnsByPricing } from '../../lib/addon-pricing';
import ReportAddOnCard from './ReportAddOnCard';
import ReportInvestmentSummary from './ReportInvestmentSummary';
import { AttributionModelHelpTrigger } from './AttributionModelHelpModal';
import { uploadReportScreenshot, uploadRevenueOpportunityImage } from '../../lib/db';
import type { AuditSection, AuditAsset, Annotation, AuditEmailDesign, RevenueOpportunityAddOnItem, KlaviyoCampaignSnapshot, KlaviyoSegmentSnapshot } from '../../lib/types';
import { normalizeWorkspaceKeyFindings, resolveExecutiveFindings } from '../../lib/findings-normalize';
import {
  materializeSectionKeyFindingsHidden,
  normalizeWorkspaceSectionKeyFindings,
  parseSectionKeyFindings,
  resolveSectionKeyFindings,
} from '../../lib/section-key-findings';
// import { buildSectionDemoMap } from '../../lib/addon-highlight';
import { buildNavSectionDemoMap } from '../../lib/addon-highlight';
import { cn } from '../../lib/utils';
import type { AuditReportBundle } from '../../hooks/useAuditReportData';
import {
  extractCampaignsRawConfig,
  extractEmailDesignRawConfig,
  extractExecutiveSummaryRawConfig,
  extractFlowsRawConfig,
  extractSegmentationRawConfig,
  extractSignupFormsRawConfig,
  isCampaignsBlockVisible,
  isDeliverabilitySnapshotBlockVisible,
  isAttributionModelBlockVisible,
  isEmailDesignBlockVisible,
  isExecutiveSummaryBlockVisible,
  isFlowsBlockVisible,
  isSegmentationBlockVisible,
  isSignupFormsBlockVisible,
  resolveCampaignsConfig,
  resolveEmailDesignConfig,
  resolveExecutiveSummaryConfig,
  resolveDeliverabilitySnapshotConfig,
  resolveFlowsConfig,
  resolveRevenueSummaryConfig,
  resolveSegmentationConfig,
  resolveSignupFormsConfig,
  extractDeliverabilitySnapshotRawConfig,
  extractAttributionModelRawConfig,
  resolveAttributionModelConfig,
} from '../../lib/report-config/resolve';
import { DEFAULT_REVENUE_SUMMARY_SECTION } from '../../lib/report-config/defaults';
import type { DeliverabilitySnapshotSectionConfig, RevenueSummarySectionConfig, GenericBlockConfig } from '../../lib/report-config/types';
import type { SectionKeyFindings } from '../../lib/types';

const NAV_ITEMS = [
  { id: 'summary', label: 'Summary' },
  { id: 'flows', label: 'Flows' },
  { id: 'deliverability', label: 'Deliverability' },
  { id: 'segments', label: 'Segments' },
  { id: 'forms', label: 'Signup Forms' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'email_design', label: 'Email Design' },
  { id: 'attribution', label: 'Attribution Model' },
  { id: 'addons', label: 'Add-Ons' },
  { id: 'opportunity', label: 'Revenue Opportunity' },
];

export type AuditReportViewProps = {
  data: AuditReportBundle;
  topBanner?: ReactNode;
  onManageEmailDesign?: () => void;
  onManageRevenueOpportunities?: () => void;
};

function ReportSectionShell({
  id,
  setRef,
  label,
  hidden,
  onToggleHidden,
  available,
  actions,
  showTopSeparator = id !== 'summary',
  children,
}: {
  id: string;
  setRef: (id: string) => (el: HTMLElement | null) => void;
  label: string;
  hidden: boolean;
  onToggleHidden: (hidden: boolean) => void;
  available: boolean;
  actions?: ReturnType<typeof emailDesignAction>[];
  showTopSeparator?: boolean;
  children: ReactNode;
}) {
  const { editMode } = useReportEdit();
  const topSeparator = showTopSeparator ? (
    <div
      className="mb-10 h-px w-full bg-gradient-to-r from-transparent via-gray-200/70 to-transparent"
      aria-hidden
    />
  ) : null;
  if (!available && !editMode) return null;
  if (!editMode) {
    if (hidden) return null;
    return (
      <section id={id} ref={setRef(id)} className="relative">
        {topSeparator}
        {children}
      </section>
    );
  }
  return (
    <section id={id} ref={setRef(id)} className="relative">
      <ReportSectionEditChrome
        label={label}
        hidden={hidden}
        onToggleHidden={onToggleHidden}
        actions={actions}
      >
        {!hidden ? (
          <>
            {topSeparator}
            {children}
          </>
        ) : null}
      </ReportSectionEditChrome>
    </section>
  );
}

export default function AuditReportView({ data, topBanner, onManageEmailDesign, onManageRevenueOpportunities }: AuditReportViewProps) {
  const {
    editMode,
    updateLayoutTitle,
    updateBlockTitle,
    updateAddOnField,
    updateAddOnPrice,
    updateAddOnContent,
    updateAddOnImage,
    updateAddOnImageScale,
    updateAttributionScreenshot,
    updateAttributionScreenshotScale,
    updateSectionRevenueOpportunity,
    toggleLayoutSectionHidden,
    toggleAuditSectionHidden,
    toggleExecutiveBlockHidden,
    toggleRevenueBlockHidden,
    toggleFlowsBlockHidden,
    toggleTimelinePhaseHidden,
    updateSectionBlockField,
    patchSectionBlock,
  } = useReportEdit();
  const [activeSection, setActiveSection] = useState('summary');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [demoPopup, setDemoPopup] = useState<DemoPopupState | null>(null);
  const [uploadingAddOnKey, setUploadingAddOnKey] = useState<string | null>(null);
  const [uploadingAttribution, setUploadingAttribution] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const handleAddOnImageUpload = async (itemKey: string, file: File | undefined) => {
    if (!file) return;
    setUploadingAddOnKey(itemKey);
    try {
      const url = await uploadRevenueOpportunityImage(file);
      updateAddOnImage(itemKey, url);
    } catch {
      /* swallow — surfaced via missing image */
    } finally {
      setUploadingAddOnKey(null);
    }
  };

  const handleAttributionImageUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAttribution(true);
    try {
      const url = await uploadReportScreenshot(file, 'attribution');
      updateAttributionScreenshot(url);
    } catch {
      /* swallow */
    } finally {
      setUploadingAttribution(false);
    }
  };

  const {
    audit,
    client,
    sections,
    assets,
    annotations,
    flowPerformance,
    flowSnapshots,
    segmentSnapshots,
    formSnapshots,
    campaignSnapshots,
    emailDesign,
    reportingDiagnostic,
    accountSnapshot,
    klaviyoGroupNameMap,
  } = data;

  useEffect(() => {
    if (client?.company_name) {
      document.title = `${client.company_name} | Klaviyo Email Audit`;
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

  const isPreview = audit.status === 'draft' || audit.status === 'in_review';

  const revenueBreakdown = accountSnapshot?.revenue_breakdown ?? null;

  const reportSections = useMemo(
    () => sections.filter(section => section.section_key !== 'revenue_summary' && section.status !== 'draft'),
    [sections],
  );

  const executiveSummaryData = useMemo(() => {
    let execText = audit.executive_summary || '';
    let rawFindings: string[] | undefined;
    let aiStrengths: string[] = [];
    let aiConcerns: string[] = [];
    let aiTimeline: { phase: string; timeframe: string; label: string; items: string[] }[] = [];
    let findingsHidden: boolean[] = [];
    let strengthsHidden: boolean[] = [];
    let timelineHidden: boolean[] = [];
    try {
      const parsed = JSON.parse(audit.executive_summary || '');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof parsed.text === 'string') execText = parsed.text;
        rawFindings = Array.isArray(parsed.findings) ? parsed.findings : undefined;
        aiStrengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
        aiConcerns = Array.isArray(parsed.concerns) ? parsed.concerns : [];
        aiTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
        findingsHidden = Array.isArray(parsed.findingsHidden) ? parsed.findingsHidden.map(Boolean) : [];
        strengthsHidden = Array.isArray(parsed.strengthsHidden) ? parsed.strengthsHidden.map(Boolean) : [];
        timelineHidden = Array.isArray(parsed.timelineHidden) ? parsed.timelineHidden.map(Boolean) : [];
      }
    } catch {
      // plain text — keep as-is
    }
    const aiFindings = editMode
      ? normalizeWorkspaceKeyFindings(rawFindings, aiConcerns)
      : resolveExecutiveFindings(rawFindings, aiConcerns);
    return {
      execText,
      aiFindings,
      aiStrengths,
      aiTimeline,
      findingsHidden,
      strengthsHidden,
      timelineHidden,
    };
  }, [audit.executive_summary, editMode]);

  const {
    execText,
    aiFindings,
    aiStrengths,
    aiTimeline,
    findingsHidden,
    strengthsHidden,
    timelineHidden,
  } = executiveSummaryData;

  const auditLayout = useMemo(
    () => (audit.layout as Record<string, unknown> | null | undefined) ?? {},
    [audit.layout],
  );

  const sectionConfigs = useMemo(() => {
    const pickConfig = (key: string) =>
      (reportSections.find(section => section.section_key === key)?.section_config as Record<string, unknown> | null | undefined) ?? null;

    const flowsSectionRow = reportSections.find(section => section.section_key === 'flows');
    const flowsCfg = resolveFlowsConfig(extractFlowsRawConfig(pickConfig('flows')));

    const segmentationSectionRow = reportSections.find(section => section.section_key === 'segmentation');
    const segmentationCfg = resolveSegmentationConfig(extractSegmentationRawConfig(pickConfig('segmentation')));

    const signupFormsSectionRow = reportSections.find(section => section.section_key === 'signup_forms');
    const signupFormsCfg = resolveSignupFormsConfig(extractSignupFormsRawConfig(pickConfig('signup_forms')));

    const campaignsSectionRow = reportSections.find(section => section.section_key === 'campaigns');
    const campaignsCfg = resolveCampaignsConfig(extractCampaignsRawConfig(pickConfig('campaigns')));

    const emailDesignSectionRow = reportSections.find(section => section.section_key === 'email_design');
    const emailDesignCfg = resolveEmailDesignConfig(extractEmailDesignRawConfig(pickConfig('email_design')));

    const revenueSummaryRaw = auditLayout.revenue_summary as Partial<RevenueSummarySectionConfig> | null | undefined;
    const revenueSummaryCfg = resolveRevenueSummaryConfig(
      revenueSummaryRaw && typeof revenueSummaryRaw === 'object' ? revenueSummaryRaw : undefined,
    );

    const deliverabilitySnapshotCfg = resolveDeliverabilitySnapshotConfig(
      extractDeliverabilitySnapshotRawConfig(auditLayout),
    );

    const attributionModelCfg = resolveAttributionModelConfig(
      extractAttributionModelRawConfig(auditLayout),
    );

    const executiveSummaryCfg = resolveExecutiveSummaryConfig(
      extractExecutiveSummaryRawConfig(auditLayout),
    );

    return {
      flowsSectionRow,
      flowsCfg,
      segmentationSectionRow,
      segmentationCfg,
      signupFormsSectionRow,
      signupFormsCfg,
      campaignsSectionRow,
      campaignsCfg,
      emailDesignSectionRow,
      emailDesignCfg,
      revenueSummaryCfg,
      deliverabilitySnapshotCfg,
      attributionModelCfg,
      executiveSummaryCfg,
    };
  }, [auditLayout, reportSections]);

  const {
    flowsSectionRow,
    flowsCfg,
    segmentationSectionRow,
    segmentationCfg,
    signupFormsSectionRow,
    signupFormsCfg,
    campaignsSectionRow,
    campaignsCfg,
    emailDesignSectionRow,
    emailDesignCfg,
    revenueSummaryCfg,
    deliverabilitySnapshotCfg,
    attributionModelCfg,
    executiveSummaryCfg,
  } = sectionConfigs;

  const visibleAddOnItems = useMemo(() => {
    const addOnItemsRaw = revenueSummaryCfg.blocks.addOns?.items;
    return Array.isArray(addOnItemsRaw)
      ? addOnItemsRaw
        .filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object')
        .map((item, index) => ({
          ...item,
          content: resolveRevenueOpportunityContent(item),
          bullets: Array.isArray(item.bullets) ? item.bullets.map(value => String(value)) : [],
          revenue_monthly: Number(item.revenue_monthly ?? 0),
          one_time_price: item.one_time_price != null ? Number(item.one_time_price) : null,
          one_time_label: item.one_time_label ?? null,
          monthly_price: item.monthly_price != null ? Number(item.monthly_price) : null,
          monthly_label: item.monthly_label ?? null,
          display_order: typeof item.display_order === 'number' ? item.display_order : (index + 1) * 10,
          is_hidden: Boolean(item.is_hidden),
          highlighted: Boolean(item.highlighted),
          related_section_keys: Array.isArray(item.related_section_keys)
            ? item.related_section_keys.map(v => String(v))
            : undefined,
          presenter_note: item.presenter_note ? String(item.presenter_note) : undefined,
          investment_included: item.investment_included !== false,
          image_scale: item.image_scale ?? null,
        }))
        .filter(item => !item.is_hidden)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      : [];
  }, [revenueSummaryCfg]);

  const addOnCatalogItems = useMemo(() => {
    const addOnItemsRaw = revenueSummaryCfg.blocks.addOns?.items;
    return Array.isArray(addOnItemsRaw)
      ? addOnItemsRaw
        .filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object')
        .map((item, index) => ({
          ...item,
          template_slug: String(item.template_slug ?? ''),
          name: String(item.name ?? ''),
          display_order: typeof item.display_order === 'number' ? item.display_order : (index + 1) * 10,
          is_hidden: Boolean(item.is_hidden),
          highlighted: Boolean(item.highlighted),
          related_section_keys: Array.isArray(item.related_section_keys)
            ? item.related_section_keys.map(v => String(v))
            : undefined,
          presenter_note: item.presenter_note ? String(item.presenter_note) : undefined,
          investment_included: item.investment_included !== false,
        }))
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      : [];
  }, [revenueSummaryCfg]);

  const sectionDemoMap = useMemo(
    () => buildNavSectionDemoMap(visibleAddOnItems),
    [visibleAddOnItems],
  );
  const demoFor = (navId: string) => sectionDemoMap.get(navId) ?? [];

  const { oneTime: oneTimeAddOns, monthly: monthlyAddOns, unpriced: unpricedAddOns } = useMemo(
    () => splitAddOnsByPricing(visibleAddOnItems),
    [visibleAddOnItems],
  );
  const hasPricedAddOns = oneTimeAddOns.length > 0 || monthlyAddOns.length > 0;
  const investmentSummaryItems = useMemo(
    () => addOnCatalogItems.filter(item => !item.is_hidden && addOnHasPricing(item)),
    [addOnCatalogItems],
  );
  const investmentSummaryAvailable = investmentSummaryItems.length > 0;
  const addOnsSectionAvailable = visibleAddOnItems.length > 0;

  const customerAgentDemoUrl = useMemo(
    () => resolveCustomerAgentDemoUrl(client?.website_url),
    [client?.website_url],
  );

  const totalRevenue = useMemo(() => {
    if (!editMode && typeof audit.total_revenue_opportunity === 'number') {
      return audit.total_revenue_opportunity;
    }
    return computeAuditTotalRevenueOpportunity(sections, auditLayout);
  }, [editMode, audit.total_revenue_opportunity, sections, auditLayout]);

  const flowsDataAvailable = flowSnapshots.length > 0 || flowPerformance.length > 0;
  const emailDesignDataAvailable =
    Boolean(emailDesign?.client_email_html || emailDesign?.ecd_example) || editMode;
  const attributionSectionAvailable =
    Boolean(attributionModelCfg.screenshot_url?.trim()) || editMode;

  const sectionHiddenFlags = useMemo<Record<string, boolean>>(
    () => ({
      summary: Boolean(executiveSummaryCfg.hidden),
      flows: Boolean(flowsCfg.hidden),
      deliverability: Boolean(deliverabilitySnapshotCfg.hidden),
      segments: Boolean(segmentationCfg.hidden),
      forms: Boolean(signupFormsCfg.hidden),
      campaigns: Boolean(campaignsCfg.hidden),
      email_design: Boolean(emailDesignCfg.hidden),
      attribution: Boolean(attributionModelCfg.hidden),
      addons: Boolean(revenueSummaryCfg.blocks.addOns?.hidden),
      opportunity: Boolean(revenueSummaryCfg.hidden),
    }),
    [executiveSummaryCfg, flowsCfg, deliverabilitySnapshotCfg, segmentationCfg, signupFormsCfg, campaignsCfg, emailDesignCfg, attributionModelCfg, revenueSummaryCfg],
  );

  const sectionDataAvailable = useMemo<Record<string, boolean>>(
    () => ({
      summary: true,
      flows: flowsDataAvailable,
      deliverability: Boolean(accountSnapshot?.deliverability),
      segments: segmentSnapshots.length > 0,
      forms: formSnapshots.length > 0,
      campaigns: campaignSnapshots.length > 0,
      email_design: emailDesignDataAvailable,
      attribution: attributionSectionAvailable,
      addons: addOnsSectionAvailable,
      opportunity: true,
    }),
    [flowsDataAvailable, accountSnapshot?.deliverability, segmentSnapshots.length, formSnapshots.length, campaignSnapshots.length, emailDesignDataAvailable, attributionSectionAvailable, addOnsSectionAvailable],
  );

  const sectionVisibility = useMemo<Record<string, boolean>>(
    () => ({
      summary: !sectionHiddenFlags.summary,
      flows: flowsDataAvailable && !sectionHiddenFlags.flows,
      deliverability: Boolean(accountSnapshot?.deliverability) && !sectionHiddenFlags.deliverability,
      segments: segmentSnapshots.length > 0 && !sectionHiddenFlags.segments,
      forms: formSnapshots.length > 0 && !sectionHiddenFlags.forms,
      campaigns: campaignSnapshots.length > 0 && !sectionHiddenFlags.campaigns,
      email_design: emailDesignDataAvailable && !sectionHiddenFlags.email_design,
      attribution: attributionSectionAvailable && !sectionHiddenFlags.attribution,
      addons: addOnsSectionAvailable && !sectionHiddenFlags.addons,
      opportunity: !sectionHiddenFlags.opportunity,
    }),
    [
      sectionHiddenFlags,
      flowsDataAvailable,
      segmentSnapshots.length,
      formSnapshots.length,
      campaignSnapshots.length,
      emailDesignDataAvailable,
      attributionSectionAvailable,
      addOnsSectionAvailable,
    ],
  );

  const navSectionIds = useMemo(
    () =>
      NAV_ITEMS.filter(item => {
        if (!sectionDataAvailable[item.id]) return false;
        if (editMode) return true;
        return sectionVisibility[item.id];
      }),
    [sectionDataAvailable, editMode, sectionVisibility],
  );

  const sectionNumbers = useMemo(() => {
    const numbers: Record<string, string> = {};
    let n = 1;
    for (const item of navSectionIds) {
      if (sectionHiddenFlags[item.id] && editMode) {
        numbers[item.id] = '—';
        continue;
      }
      if (!sectionVisibility[item.id]) continue;
      numbers[item.id] = String(n).padStart(2, '0');
      n += 1;
    }
    return numbers;
  }, [navSectionIds, sectionHiddenFlags, editMode, sectionVisibility]);

  const visibleNavItems = useMemo(
    () =>
      navSectionIds.map(item => ({
        ...item,
        isHidden: sectionHiddenFlags[item.id],
      })),
    [navSectionIds, sectionHiddenFlags],
  );

  const setRef = (id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  };

  const preparedDateLabel = audit.published_at
    ? new Date(audit.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : audit.created_at
      ? new Date(audit.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'recently';

  return (
    <ReportEntityProvider
      flowSnapshots={flowSnapshots}
      flowPerformance={flowPerformance}
      segmentSnapshots={segmentSnapshots}
      campaignSnapshots={campaignSnapshots}
      formSnapshots={formSnapshots}
    >
    <div className="min-h-screen bg-brand-surface">
      {topBanner}
      {editMode && (
        <div className="border-b border-brand-primary/20 bg-brand-primary/5 px-6 py-2.5 text-center">
          <span className="text-sm font-medium text-gray-700">
            <span className="font-semibold text-brand-primary">Edit mode</span>
            {' — '}
            Click text, titles, and values in the report below to update them. Changes save automatically.
          </span>
        </div>
      )}
      {isPreview && !topBanner && (
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
                  const headerOffset = editMode && isPreview ? 128 : isPreview || editMode ? 90 : 52;
                  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                  window.scrollTo({ top, behavior: 'smooth' });
                }}
                className={`px-4 py-3.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeSection === item.id
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                } ${item.isHidden ? 'opacity-50' : ''}`}
              >
                {item.label}{item.isHidden ? ' (hidden)' : ''}
              </a>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-[90rem] mx-auto px-6 py-10 space-y-16">
        <ReportSectionShell
          id="summary"
          setRef={setRef}
          label={executiveSummaryCfg.sectionTitle ?? 'Executive Summary'}
          hidden={sectionHiddenFlags.summary}
          onToggleHidden={h => toggleLayoutSectionHidden('executive_summary', h)}
          available={sectionDataAvailable.summary}
        >
          <ReportCover
            companyName={client.company_name}
            preparedDate={preparedDateLabel}
            websiteUrl={client.website_url}
            totalRevenueOpportunity={totalRevenue}
          />

            <ReportSectionHeader
            number={sectionNumbers['summary'] ?? executiveSummaryCfg.sectionNumber ?? '01'}
            label={executiveSummaryCfg.sectionTitle ?? 'Executive Summary'}
            onSaveLabel={v => updateLayoutTitle('executive_summary', 'sectionTitle', v)}
          />

          {(isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'accountSnapshot') || editMode) &&
            (flowSnapshots.length > 0 || campaignSnapshots.length > 0 || editMode) && (
              <ReportBlockEditChrome
                label="Account Snapshot"
                hidden={executiveSummaryCfg.blocks.accountSnapshot?.hidden === true}
                onToggleHidden={h => toggleExecutiveBlockHidden('accountSnapshot', h)}
              >
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <ReportBlockHeader
                  icon={
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                      <LayoutDashboard className="h-5 w-5 shrink-0 stroke-gray-500 text-gray-500" strokeWidth={2.25} />
                    </div>
                  }
                  title={
                    <EditablePlainText
                      value={executiveSummaryCfg.blocks.accountSnapshot?.title ?? 'Account Snapshot'}
                      onSave={v => updateBlockTitle('executive_summary', 'accountSnapshot', 'title', v)}
                      className="text-base font-bold text-gray-900"
                      as="span"
                    />
                  }
                  subtitle={
                    <EditablePlainText
                      value={executiveSummaryCfg.blocks.accountSnapshot?.subtitle ?? 'Live metrics pulled from Klaviyo at the time of this audit'}
                      onSave={v => updateBlockTitle('executive_summary', 'accountSnapshot', 'subtitle', v)}
                      className="text-sm text-gray-500"
                      as="span"
                    />
                  }
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
              </ReportBlockEditChrome>
            )}

          {(isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'strengths') || editMode) && (
            <ReportStrengthsPanel
              title={executiveSummaryCfg.blocks.strengths?.title ?? "What's Working"}
              strengths={aiStrengths.length > 0 ? aiStrengths : ['', '', '']}
              strengthsHidden={strengthsHidden}
              blockHidden={executiveSummaryCfg.blocks.strengths?.hidden === true}
            />
          )}

          {(isExecutiveSummaryBlockVisible(executiveSummaryCfg, 'findings') || editMode) && (
            <ReportKeyFindings
              title={executiveSummaryCfg.blocks.findings?.title ?? 'General Key Findings'}
              subtitle={executiveSummaryCfg.blocks.findings?.subtitle}
              findings={aiFindings}
              findingsHidden={findingsHidden}
              blockHidden={executiveSummaryCfg.blocks.findings?.hidden === true}
            />
          )}

        </ReportSectionShell>

        <ReportSectionShell
          id="flows"
          setRef={setRef}
          label={flowsCfg.sectionTitle ?? 'Flows'}
          hidden={sectionHiddenFlags.flows}
          onToggleHidden={h => toggleAuditSectionHidden('flows', h)}
          available={sectionDataAvailable.flows}
        >
            <ReportSectionHeader
              number={sectionNumbers['flows'] ?? flowsCfg.sectionNumber ?? '03'}
              label={flowsCfg.sectionTitle ?? 'Flows'}
              sectionKey="flows"
              addOnItems={addOnCatalogItems}
              demoMarkers={demoFor('flows')}
            />

            {((isFlowsBlockVisible(flowsCfg, 'narrative') || isFlowsBlockVisible(flowsCfg, 'rubric')) || editMode) && (() => {
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
                <ReportBlockEditChrome
                  label="Current & optimized state"
                  hidden={!narrativeVisible && !rubricVisible && (narrativeCfg?.hidden === true || flowsCfg.blocks.rubric?.hidden === true)}
                  onToggleHidden={h => toggleFlowsBlockHidden('narrative', h)}
                  className="mb-6"
                >
                  <ReportSectionBlock
                    section={sectionForBlock}
                    index={idx < 0 ? 0 : idx}
                    assets={assets}
                    annotations={annotations}
                    hideHeader
                    hideCurrentOptimized={!narrativeVisible}
                    hideRubric={!rubricVisible}
                  />
                </ReportBlockEditChrome>
              );
            })()}

            <div className="mt-6 space-y-6">
            {(isFlowsBlockVisible(flowsCfg, 'healthScore') || editMode) && flowPerformance.length > 0 && (
              <ReportBlockEditChrome
                label="Overall Flow Health Score"
                hidden={flowsCfg.blocks.healthScore?.hidden === true}
                onToggleHidden={h => toggleFlowsBlockHidden('healthScore', h)}
              >
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <ReportFlowHealthScore
                  snapshots={flowSnapshots as any}
                  performance={flowPerformance}
                  segmentCount={segmentSnapshots.length}
                  title={
                    editMode ? (
                      <EditablePlainText
                        value={flowsCfg.blocks.healthScore?.title ?? 'Overall Flow Health Score'}
                        onSave={v => updateSectionBlockField('flows', 'healthScore', 'title', v)}
                        className="text-lg font-bold text-gray-900"
                        as="span"
                      />
                    ) : (
                      flowsCfg.blocks.healthScore?.title ?? 'Overall Flow Health Score'
                    )
                  }
                  subtitle={
                    editMode ? (
                      <EditablePlainText
                        value={flowsCfg.blocks.healthScore?.subtitle ?? ''}
                        onSave={v => updateSectionBlockField('flows', 'healthScore', 'subtitle', v)}
                        className="text-sm text-gray-500"
                        as="span"
                        placeholder="Optional subtitle…"
                      />
                    ) : (
                      flowsCfg.blocks.healthScore?.subtitle
                    )
                  }
                  benchmarks={flowsCfg.blocks.healthScore?.benchmarks}
                />
              </div>
              </ReportBlockEditChrome>
            )}

            {isFlowsBlockVisible(flowsCfg, 'revenueBreakdown') && flowPerformance.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <ReportFlowRevenueBreakdown
                  performance={flowPerformance}
                  revenueBreakdown={revenueBreakdown}
                  title={
                    editMode ? (
                      <EditablePlainText
                        value={flowsCfg.blocks.revenueBreakdown?.title ?? 'Revenue Breakdown by Flow'}
                        onSave={v => updateSectionBlockField('flows', 'revenueBreakdown', 'title', v)}
                        className="text-lg font-bold text-gray-900"
                        as="span"
                      />
                    ) : (
                      flowsCfg.blocks.revenueBreakdown?.title
                    )
                  }
                />
              </div>
            )}

            {isFlowsBlockVisible(flowsCfg, 'flowTable') && flowPerformance.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <ReportBlockHeader
                  icon={
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                      <Activity className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                    </div>
                  }
                  title={
                    editMode ? (
                      <EditablePlainText
                        value={flowsCfg.blocks.flowTable?.title ?? 'Flow Performance Details'}
                        onSave={v => updateSectionBlockField('flows', 'flowTable', 'title', v)}
                        className="text-base font-bold text-gray-900"
                        as="span"
                      />
                    ) : (
                      flowsCfg.blocks.flowTable?.title ?? 'Flow Performance Details'
                    )
                  }
                />
                <div className="p-6">
                  <ReportFlowTable
                    flows={flowPerformance}
                    revenueBreakdown={revenueBreakdown}
                    defaultVisibleRows={flowsCfg.blocks.flowTable?.defaultVisibleRows}
                    subtitleOverride={flowsCfg.blocks.flowTable?.subtitleOverride}
                    totalFlowCount={flowSnapshots.filter((f: { is_hidden?: boolean }) => !f.is_hidden).length}
                  />
                </div>
              </div>
            )}
            </div>

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

            {(isFlowsBlockVisible(flowsCfg, 'keyFindings') || editMode) && (
              <AuditSectionKeyFindingsPanel
                sectionKey="flows"
                section={flowsSectionRow}
                blockCfg={flowsCfg.blocks.keyFindings}
                blockVisible={isFlowsBlockVisible(flowsCfg, 'keyFindings')}
              />
            )}
        </ReportSectionShell>

        <ReportSectionShell
          id="deliverability"
          setRef={setRef}
          label={deliverabilitySnapshotCfg.sectionTitle ?? 'Deliverability'}
          hidden={sectionHiddenFlags.deliverability}
          onToggleHidden={h => toggleLayoutSectionHidden('deliverability_snapshot', h)}
          available={sectionDataAvailable.deliverability}
        >
          <ReportSectionHeader
            number={sectionNumbers['deliverability'] ?? deliverabilitySnapshotCfg.sectionNumber ?? '04'}
            label={
              editMode ? (
                <EditablePlainText
                  value={deliverabilitySnapshotCfg.sectionTitle ?? 'Deliverability'}
                  onSave={v => updateLayoutTitle('deliverability_snapshot', 'sectionTitle', v)}
                  className="text-base font-bold text-gray-900"
                  as="span"
                />
              ) : (
                deliverabilitySnapshotCfg.sectionTitle ?? 'Deliverability'
              )
            }
            demoMarkers={demoFor('deliverability')}
            sectionKey="account_health"
            addOnItems={addOnCatalogItems}
          />
          <ReportDeliverabilitySnapshot deliverability={accountSnapshot?.deliverability} />
          {(isDeliverabilitySnapshotBlockVisible(deliverabilitySnapshotCfg, 'keyFindings') || editMode) && (
            <LayoutSectionKeyFindingsPanel
              layoutKey="deliverability_snapshot"
              keyFindings={deliverabilitySnapshotCfg.key_findings}
              blockCfg={deliverabilitySnapshotCfg.blocks?.keyFindings}
              blockVisible={isDeliverabilitySnapshotBlockVisible(deliverabilitySnapshotCfg, 'keyFindings')}
            />
          )}
        </ReportSectionShell>

        <ReportSectionShell
          id="segments"
          setRef={setRef}
          label={segmentationCfg.sectionTitle ?? 'Segments'}
          hidden={sectionHiddenFlags.segments}
          onToggleHidden={h => toggleAuditSectionHidden('segmentation', h)}
          available={sectionDataAvailable.segments}
        >
            <ReportSectionHeader
              number={sectionNumbers['segments'] ?? segmentationCfg.sectionNumber ?? '04'}
              label={segmentationCfg.sectionTitle ?? 'Segments'}
              sectionKey="segmentation"
              addOnItems={addOnCatalogItems}
              demoMarkers={demoFor('segments')}
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
                  />
                </div>
              );
            })()}

            {isSegmentationBlockVisible(segmentationCfg, 'segmentTable') && campaignSnapshots.length > 0 && (
              <ReportCampaignAudienceSegments
                campaigns={campaignSnapshots as KlaviyoCampaignSnapshot[]}
                segmentSnapshots={segmentSnapshots as KlaviyoSegmentSnapshot[]}
                klaviyoGroupNameMap={klaviyoGroupNameMap}
              />
            )}

            {isSegmentationBlockVisible(segmentationCfg, 'segmentTable') && (
              <ReportInventoryLauncher
                title={segmentationCfg.blocks.segmentTable?.title ?? 'Segment inventory'}
                subtitle={segmentationCfg.blocks.segmentTable?.subtitle}
                count={segmentSnapshots.filter((s: { is_hidden?: boolean }) => !s.is_hidden).length}
                countLabel="segments"
                modalTitle={segmentationCfg.blocks.segmentTable?.title ?? 'Segment inventory'}
                modalSubtitle="Inventory of segments pulled directly from Klaviyo for this audit."
              >
                <ReportSegmentTable
                  segments={segmentSnapshots as KlaviyoSegmentSnapshot[]}
                  campaigns={campaignSnapshots as KlaviyoCampaignSnapshot[]}
                  klaviyoGroupNameMap={klaviyoGroupNameMap}
                  scrollable
                />
              </ReportInventoryLauncher>
            )}

            {(isSegmentationBlockVisible(segmentationCfg, 'keyFindings') || editMode) && (
              <AuditSectionKeyFindingsPanel
                sectionKey="segmentation"
                section={segmentationSectionRow}
                blockCfg={segmentationCfg.blocks.keyFindings}
                blockVisible={isSegmentationBlockVisible(segmentationCfg, 'keyFindings')}
              />
            )}
        </ReportSectionShell>

        <ReportSectionShell
          id="forms"
          setRef={setRef}
          label={signupFormsCfg.sectionTitle ?? 'Signup Forms'}
          hidden={sectionHiddenFlags.forms}
          onToggleHidden={h => toggleAuditSectionHidden('signup_forms', h)}
          available={sectionDataAvailable.forms}
        >
            <ReportSectionHeader
              number={sectionNumbers['forms'] ?? signupFormsCfg.sectionNumber ?? '05'}
              label={signupFormsCfg.sectionTitle ?? 'Signup Forms'}
              sectionKey="signup_forms"
              addOnItems={addOnCatalogItems}
              demoMarkers={demoFor('forms')}
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

            {(isSignupFormsBlockVisible(signupFormsCfg, 'keyFindings') || editMode) && (
              <AuditSectionKeyFindingsPanel
                sectionKey="signup_forms"
                section={signupFormsSectionRow}
                blockCfg={signupFormsCfg.blocks.keyFindings}
                blockVisible={isSignupFormsBlockVisible(signupFormsCfg, 'keyFindings')}
              />
            )}
        </ReportSectionShell>

        <ReportSectionShell
          id="campaigns"
          setRef={setRef}
          label={campaignsCfg.sectionTitle ?? 'Campaigns'}
          hidden={sectionHiddenFlags.campaigns}
          onToggleHidden={h => toggleAuditSectionHidden('campaigns', h)}
          available={sectionDataAvailable.campaigns}
        >
            <ReportSectionHeader
              number={sectionNumbers['campaigns'] ?? campaignsCfg.sectionNumber ?? '06'}
              label={campaignsCfg.sectionTitle ?? 'Campaigns'}
              sectionKey="campaigns"
              addOnItems={addOnCatalogItems}
              demoMarkers={demoFor('campaigns')}
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

            {(isCampaignsBlockVisible(campaignsCfg, 'keyFindings') || editMode) && (
              <AuditSectionKeyFindingsPanel
                sectionKey="campaigns"
                section={campaignsSectionRow}
                blockCfg={campaignsCfg.blocks.keyFindings}
                blockVisible={isCampaignsBlockVisible(campaignsCfg, 'keyFindings')}
              />
            )}
        </ReportSectionShell>

        <ReportSectionShell
          id="email_design"
          setRef={setRef}
          label={emailDesignCfg.sectionTitle ?? 'Email Design'}
          hidden={sectionHiddenFlags.email_design}
          onToggleHidden={h => toggleAuditSectionHidden('email_design', h)}
          available={sectionDataAvailable.email_design}
          actions={onManageEmailDesign ? [emailDesignAction(onManageEmailDesign)] : undefined}
        >
          {emailDesign && isEmailDesignBlockVisible(emailDesignCfg, 'comparison') ? (
            <>
              <ReportSectionHeader
                number={sectionNumbers['email_design'] ?? emailDesignCfg.sectionNumber ?? '07'}
                label={emailDesignCfg.sectionTitle ?? 'Email Design'}
                sectionKey="email_design"
                addOnItems={addOnCatalogItems}
                demoMarkers={demoFor('email_design')}
              />
              <EmailDesignSection
                emailDesign={emailDesign}
                annotations={annotations}
                sections={reportSections}
                subtitleOverride={emailDesignCfg.blocks.comparison?.subtitle}
                benchmarkTitle={emailDesignCfg.blocks.comparison?.title}
                clientTitle={(emailDesignCfg.blocks.comparison as { clientTitle?: string } | undefined)?.clientTitle}
              />
              {(isEmailDesignBlockVisible(emailDesignCfg, 'keyFindings') || editMode) && (
                <AuditSectionKeyFindingsPanel
                  sectionKey="email_design"
                  section={emailDesignSectionRow}
                  blockCfg={emailDesignCfg.blocks.keyFindings}
                  blockVisible={isEmailDesignBlockVisible(emailDesignCfg, 'keyFindings')}
                />
              )}
            </>
          ) : editMode ? (
            <>
              <ReportSectionHeader
                number={sectionNumbers['email_design'] ?? emailDesignCfg.sectionNumber ?? '07'}
                label={emailDesignCfg.sectionTitle ?? 'Email Design'}
                sectionKey="email_design"
                addOnItems={addOnCatalogItems}
                demoMarkers={demoFor('email_design')}
              />
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center">
              <p className="text-sm text-gray-600">No email design data yet.</p>
              {onManageEmailDesign && (
                <button
                  type="button"
                  onClick={onManageEmailDesign}
                  className="mt-3 text-sm font-medium text-brand-primary hover:underline"
                >
                  Assign benchmark & add annotations
                </button>
              )}
            </div>
              {(isEmailDesignBlockVisible(emailDesignCfg, 'keyFindings') || editMode) && (
                <AuditSectionKeyFindingsPanel
                  sectionKey="email_design"
                  section={emailDesignSectionRow}
                  blockCfg={emailDesignCfg.blocks.keyFindings}
                  blockVisible={isEmailDesignBlockVisible(emailDesignCfg, 'keyFindings')}
                />
              )}
            </>
          ) : null}
        </ReportSectionShell>

        <ReportSectionShell
          id="attribution"
          setRef={setRef}
          label={attributionModelCfg.sectionTitle ?? 'Attribution Model'}
          hidden={sectionHiddenFlags.attribution}
          onToggleHidden={h => toggleLayoutSectionHidden('attribution_model', h)}
          available={attributionSectionAvailable}
        >
          <ReportSectionHeader
            number={sectionNumbers.attribution ?? '—'}
            label={attributionModelCfg.sectionTitle ?? 'Attribution Model'}
            onSaveLabel={
              editMode
                ? v => updateLayoutTitle('attribution_model', 'sectionTitle', v)
                : undefined
            }
          />
          {editMode && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <AttributionModelHelpTrigger />
              <p className="text-xs text-gray-500">
                Need a screenshot? Follow the guide — skip this section if the account already matches ECD standards.
              </p>
            </div>
          )}
          <div className="mt-6">
            {attributionModelCfg.screenshot_url ? (
              editMode ? (
                <ImageUploadZone
                  previewUrl={attributionModelCfg.screenshot_url}
                  previewAlt="Attribution model screenshot"
                  uploading={uploadingAttribution}
                  onFile={handleAttributionImageUpload}
                  onRemove={() => updateAttributionScreenshot(null)}
                  onPreviewClick={() => setLightboxSrc(attributionModelCfg.screenshot_url ?? '')}
                  imageScale={attributionModelCfg.screenshot_scale}
                  onImageScaleChange={updateAttributionScreenshotScale}
                  resizable
                  className="mt-0"
                />
              ) : (
                <ResizableReportImage
                  src={attributionModelCfg.screenshot_url}
                  alt="Attribution model settings"
                  scale={attributionModelCfg.screenshot_scale}
                  onClick={() => setLightboxSrc(attributionModelCfg.screenshot_url ?? '')}
                />
              )
            ) : editMode ? (
              <ImageUploadZone
                label="Add attribution screenshot"
                uploading={uploadingAttribution}
                onFile={handleAttributionImageUpload}
              />
            ) : null}
          </div>
          {(isAttributionModelBlockVisible(attributionModelCfg, 'keyFindings') || editMode) && (
            <LayoutSectionKeyFindingsPanel
              layoutKey="attribution_model"
              keyFindings={attributionModelCfg.key_findings}
              blockCfg={attributionModelCfg.blocks?.keyFindings}
              blockVisible={isAttributionModelBlockVisible(attributionModelCfg, 'keyFindings')}
            />
          )}
        </ReportSectionShell>

        <ReportSectionShell
          id="addons"
          setRef={setRef}
          label={revenueSummaryCfg.blocks.addOns?.title ?? 'Recommended Klaviyo Add-Ons'}
          hidden={sectionHiddenFlags.addons}
          onToggleHidden={h => toggleRevenueBlockHidden('addOns', h)}
          available={addOnsSectionAvailable}
          actions={onManageRevenueOpportunities ? [revenueOpportunitiesAction(onManageRevenueOpportunities)] : undefined}
        >
          {revenueSummaryCfg.blocks.addOns && revenueSummaryCfg.blocks.addOns.hidden !== true && (
            <>
              <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <ReportBlockHeader
                  icon={
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                      <BarChart3 className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                    </div>
                  }
                  title={
                    <EditablePlainText
                      value={revenueSummaryCfg.blocks.addOns.title ?? 'Recommended Klaviyo Add-Ons'}
                      onSave={v => updateBlockTitle('revenue_summary', 'addOns', 'title', v)}
                      className="text-base font-bold text-gray-900"
                      as="span"
                    />
                  }
                  subtitle={
                    <EditablePlainText
                      value={(revenueSummaryCfg.blocks.addOns.subtitle ?? '').trim() || 'ECD services and Klaviyo add-ons selected for this audit.'}
                      onSave={v => updateBlockTitle('revenue_summary', 'addOns', 'subtitle', v)}
                      className="text-sm text-gray-500"
                      as="span"
                    />
                  }
                />
                <div className="space-y-8 p-6">
                  {oneTimeAddOns.length > 0 && (
                    <div>
                      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">
                        One-Time Implementations
                      </h3>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        {oneTimeAddOns.map(slice => (
                          <ReportAddOnCard
                            key={`${slice.item.template_slug}-${slice.item.display_order}-one-time`}
                            slice={slice}
                            customerAgentDemoUrl={customerAgentDemoUrl}
                            uploadingAddOnKey={uploadingAddOnKey}
                            onImageUpload={handleAddOnImageUpload}
                            onLightbox={setLightboxSrc}
                            onDemoOpen={(url, title) => setDemoPopup({ url, title })}
                            updateAddOnField={updateAddOnField}
                            updateAddOnContent={updateAddOnContent}
                            updateAddOnImage={updateAddOnImage}
                            updateAddOnPrice={updateAddOnPrice}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {monthlyAddOns.length > 0 && (
                    <div>
                      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">
                        Monthly Retainers
                      </h3>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        {monthlyAddOns.map(slice => (
                          <ReportAddOnCard
                            key={`${slice.item.template_slug}-${slice.item.display_order}-monthly`}
                            slice={slice}
                            customerAgentDemoUrl={customerAgentDemoUrl}
                            uploadingAddOnKey={uploadingAddOnKey}
                            onImageUpload={handleAddOnImageUpload}
                            onLightbox={setLightboxSrc}
                            onDemoOpen={(url, title) => setDemoPopup({ url, title })}
                            updateAddOnField={updateAddOnField}
                            updateAddOnContent={updateAddOnContent}
                            updateAddOnImage={updateAddOnImage}
                            updateAddOnPrice={updateAddOnPrice}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {unpricedAddOns.length > 0 && (
                    <div>
                      {hasPricedAddOns && (
                        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">
                          Additional recommendations
                        </h3>
                      )}
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        {unpricedAddOns.map(slice => (
                          <ReportAddOnCard
                            key={`${slice.item.template_slug}-${slice.item.display_order}-unpriced`}
                            slice={slice}
                            customerAgentDemoUrl={customerAgentDemoUrl}
                            uploadingAddOnKey={uploadingAddOnKey}
                            onImageUpload={handleAddOnImageUpload}
                            onLightbox={setLightboxSrc}
                            onDemoOpen={(url, title) => setDemoPopup({ url, title })}
                            updateAddOnField={updateAddOnField}
                            updateAddOnContent={updateAddOnContent}
                            updateAddOnImage={updateAddOnImage}
                            updateAddOnPrice={updateAddOnPrice}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {unpricedAddOns.length > 0 && editMode && (
                    <p className="text-sm text-amber-700 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                      Cards without one-time or monthly pricing still appear on the report (without a price
                      block). Add prices in Revenue opportunities if you want them listed with ECD fees.
                    </p>
                  )}
                </div>
              </div>
              {visibleAddOnItems.length === 0 && editMode && onManageRevenueOpportunities && (
                <div className="mb-6 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center">
                  <p className="text-sm text-gray-600">No add-ons selected for this audit yet.</p>
                  <button
                    type="button"
                    onClick={onManageRevenueOpportunities}
                    className="mt-3 text-sm font-medium text-brand-primary hover:underline"
                  >
                    Add from templates
                  </button>
                </div>
              )}
            </>
          )}
        </ReportSectionShell>

        <ReportSectionShell
          id="opportunity"
          setRef={setRef}
          label={revenueSummaryCfg.sectionTitle ?? 'Revenue Opportunity'}
          hidden={sectionHiddenFlags.opportunity}
          onToggleHidden={h => toggleLayoutSectionHidden('revenue_summary', h)}
          available={sectionDataAvailable.opportunity}
          actions={onManageRevenueOpportunities ? [revenueOpportunitiesAction(onManageRevenueOpportunities)] : undefined}
        >
          <ReportSectionHeader
            number={sectionNumbers['opportunity'] ?? revenueSummaryCfg.sectionNumber ?? '08'}
            label={revenueSummaryCfg.sectionTitle ?? 'Revenue Opportunity'}
            onSaveLabel={v => updateLayoutTitle('revenue_summary', 'sectionTitle', v)}
          />

          {/* Breakdown by Area hidden */}

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
                <EditablePlainText
                  value={revenueSummaryCfg.blocks.totalBanner?.title ?? 'Total identified opportunity'}
                  onSave={v => updateBlockTitle('revenue_summary', 'totalBanner', 'title', v)}
                  className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl"
                  as="span"
                />
              </h2>
              <div className="mb-2 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0">
                <span className="text-4xl font-extrabold tabular-nums tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-6xl">
                  {formatCurrency(totalRevenue)}
                </span>
                <span className="text-lg font-semibold text-white/80 sm:text-xl">/month</span>
              </div>
              <p className="mb-10 text-sm font-medium text-white/75">
                <EditablePlainText
                  value={revenueSummaryCfg.blocks.totalBanner?.subtitle ?? 'Additional email-attributed revenue identified in this audit'}
                  onSave={v => updateBlockTitle('revenue_summary', 'totalBanner', 'subtitle', v)}
                  className="text-sm font-medium text-white/75"
                  as="span"
                />
              </p>

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

          {revenueSummaryCfg.blocks.timeline && (revenueSummaryCfg.blocks.timeline.hidden !== true || editMode) && (
          <ReportBlockEditChrome
            label="Implementation Timeline"
            hidden={revenueSummaryCfg.blocks.timeline.hidden === true}
            onToggleHidden={h => toggleRevenueBlockHidden('timeline', h)}
            className="mt-6"
          >
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <ReportBlockHeader
              icon={
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
                  <CalendarDays className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
                </div>
              }
              title={
                <EditablePlainText
                  value={revenueSummaryCfg.blocks.timeline?.title ?? 'Implementation Timeline'}
                  onSave={v => updateBlockTitle('revenue_summary', 'timeline', 'title', v)}
                  className="text-base font-bold text-gray-900"
                  as="span"
                />
              }
              subtitle={
                <EditablePlainText
                  value={revenueSummaryCfg.blocks.timeline?.subtitle ?? 'Suggested rollout order — work through each phase before moving to the next.'}
                  onSave={v => updateBlockTitle('revenue_summary', 'timeline', 'subtitle', v)}
                  className="text-sm text-gray-500"
                  as="span"
                />
              }
            />
            <div className="p-6">
            {aiTimeline.length > 0 ? (
              <div className="space-y-8">
                {(() => {
                  let displayNumber = 0;
                  return aiTimeline.slice(0, 4).map((p, i) => {
                    const hidden = Boolean(timelineHidden[i]);
                    if (!editMode && hidden) return null;
                    if (editMode && hidden) {
                      return (
                        <ReportHiddenItemStub
                          key={i}
                          label={`Phase ${String(i + 1).padStart(2, '0')}`}
                          onRestore={() => toggleTimelinePhaseHidden(i, false)}
                        />
                      );
                    }
                    displayNumber += 1;
                    return (
                      <ImplementationTimelinePhase
                        key={i}
                        phase={p}
                        phaseIndex={i}
                        displayIndex={displayNumber - 1}
                      />
                    );
                  });
                })()}
              </div>
            ) : (
              <p className="text-sm text-gray-600 text-center py-8">AI timeline not available for this audit run.</p>
            )}
            </div>
          </div>
          </ReportBlockEditChrome>
          )}

          {(investmentSummaryAvailable || editMode) &&
            (revenueSummaryCfg.blocks.investmentSummary?.hidden !== true || editMode) && (
            <ReportInvestmentSummary
              items={investmentSummaryItems}
              title={revenueSummaryCfg.blocks.investmentSummary?.title ?? 'Investment Summary'}
              subtitle={revenueSummaryCfg.blocks.investmentSummary?.subtitle}
              hidden={revenueSummaryCfg.blocks.investmentSummary?.hidden === true}
              onToggleHidden={h => toggleRevenueBlockHidden('investmentSummary', h)}
              onSaveTitle={v => updateBlockTitle('revenue_summary', 'investmentSummary', 'title', v)}
              onSaveSubtitle={v => updateBlockTitle('revenue_summary', 'investmentSummary', 'subtitle', v)}
            />
          )}
        </ReportSectionShell>
      </main>

      <ReportTrustFooter preparedDate={preparedDateLabel} />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      <DemoPopupModal demo={demoPopup} onClose={() => setDemoPopup(null)} />
    </div>
    </ReportEntityProvider>
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

function RubricMarkdownText({ text }: { text: string }) {
  const { entityLookup, autoTagEntities } = useReportEntities();
  const { entityHighlightsEnabled } = usePlatformSettings();
  const src = String(text ?? '');
  const parts = src.split('\n');
  return (
    <>
      {parts.map((line, lineIdx) => (
        <span key={`line-${lineIdx}`}>
          {renderInlineMarkdown(line, entityLookup, autoTagEntities, entityHighlightsEnabled)}
          {lineIdx < parts.length - 1 ? <br /> : null}
        </span>
      ))}
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

function RubricStaticNote({ text }: { text: string }) {
  const raw = String(text ?? '').trim();
  if (!raw || raw === 'N/A') {
    return <p className="text-sm text-gray-400">N/A</p>;
  }
  return (
    <div className="text-sm text-gray-700 leading-relaxed [&_strong]:text-gray-900 [&_strong]:font-semibold">
      <RubricMarkdownText text={raw} />
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
        <RubricMarkdownText text={raw} />
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

function RubricInsightCard({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
      <div className="gradient-bg px-5 py-2.5">
        <div className="text-[13px] font-bold uppercase tracking-wider text-white text-center">{label}</div>
      </div>
      <div className="px-5 pt-4 pb-5">
        {children}
      </div>
    </div>
  );
}

function EditableRubricNote({
  text,
  onSave,
  collapsedLines = 4,
  expandable = true,
}: {
  text: string;
  onSave: (value: string) => void;
  collapsedLines?: number;
  expandable?: boolean;
}) {
  const { editMode } = useReportEdit();
  if (editMode) {
    return (
      <EditableRichText
        value={text || ''}
        onSave={onSave}
        className="text-sm text-gray-700 leading-relaxed [&_strong]:text-gray-900 [&_strong]:font-semibold"
        placeholder="Enter notes…"
      />
    );
  }
  if (!expandable) {
    return <RubricStaticNote text={text || 'N/A'} />;
  }
  return <RubricExpandableNote text={text || 'N/A'} collapsedLines={collapsedLines as 3 | 4 | 5} />;
}

function RubricPanelHeader({
  title,
  onSave,
}: {
  title: string;
  onSave?: (value: string) => void;
}) {
  const { editMode } = useReportEdit();
  const headerClass = 'text-[13px] font-bold uppercase tracking-wider text-white text-center';
  if (editMode && onSave) {
    return (
      <div className="gradient-bg px-5 py-2.5">
        <EditablePlainText
          value={title}
          onSave={onSave}
          className={headerClass}
          as="p"
        />
      </div>
    );
  }
  return (
    <div className="gradient-bg px-5 py-2.5">
      <p className={headerClass}>{title}</p>
    </div>
  );
}

function rubricBlockConfig(section: AuditSection): Record<string, unknown> {
  const root = (section.section_config ?? {}) as Record<string, unknown>;
  const sectionCfg = (root[section.section_key] ?? {}) as Record<string, unknown>;
  const blocks = (sectionCfg.blocks ?? {}) as Record<string, unknown>;
  return (blocks.rubric ?? {}) as Record<string, unknown>;
}

const TIMELINE_ACCENT = ['bg-emerald-500', 'bg-brand-primary', 'bg-amber-500', 'bg-slate-400'] as const;

function ImplementationTimelinePhase({
  phase,
  phaseIndex,
  displayIndex,
}: {
  phase: { phase: string; timeframe: string; label: string; items: string[] };
  phaseIndex: number;
  displayIndex: number;
}) {
  const { editMode, updateTimelinePhase, updateTimelineItem, toggleTimelinePhaseHidden } = useReportEdit();
  const [expanded, setExpanded] = useState(false);
  const items = Array.isArray(phase.items) ? phase.items : [];
  const previewCount = 5;
  const many = items.length > previewCount;
  const visibleItems = !many || expanded ? items : items.slice(0, previewCount);
  const accent = TIMELINE_ACCENT[displayIndex] ?? 'bg-slate-400';

  return (
    <div className="flex gap-4 sm:gap-5">
      <div className="shrink-0">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ${accent}`}
        >
          {displayIndex + 1}
        </div>
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-gray-100 bg-white p-4 sm:p-5 card-shadow">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <EditablePlainText
            value={phase.phase}
            onSave={v => updateTimelinePhase(phaseIndex, 'phase', v)}
            className="text-xs font-bold uppercase tracking-wide text-brand-primary"
            as="span"
          />
          <EditablePlainText
            value={phase.timeframe}
            onSave={v => updateTimelinePhase(phaseIndex, 'timeframe', v)}
            className="text-sm text-gray-600"
            as="span"
          />
          {editMode && (
            <ReportItemHideButton
              hidden={false}
              onToggleHidden={() => toggleTimelinePhaseHidden(phaseIndex, true)}
              title="Hide this phase"
            />
          )}
        </div>
        <div className="mb-4 text-base font-semibold leading-snug text-gray-900">
          <EditableRichText
            value={phase.label || ''}
            onSave={v => updateTimelinePhase(phaseIndex, 'label', v)}
            className="text-base font-semibold leading-snug text-gray-900"
          />
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
              <span className="min-w-0 [&_strong]:font-semibold [&_strong]:text-gray-900 flex-1">
                <EditableRichText
                  value={item}
                  onSave={v => updateTimelineItem(phaseIndex, j, v)}
                  className="text-sm leading-relaxed text-gray-800"
                />
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
  const { editMode, updateSectionDetailField, updateCoreFlowMatrixNote, patchSectionBlock } = useReportEdit();
  const details = parseSectionDetails((section as any).section_details);
  const sk = section.section_key;
  const rubricCfg = rubricBlockConfig(section);
  const fieldLabels = (rubricCfg.fieldLabels ?? {}) as Record<string, string>;

  const saveFieldLabel = (key: string, fallback: string, value: string) => {
    patchSectionBlock(sk, 'rubric', {
      fieldLabels: { ...fieldLabels, [key]: value || fallback },
    });
  };

  const editableLabel = (key: string, fallback: string) =>
    editMode ? (
      <EditablePlainText
        value={(fieldLabels[key] as string | undefined) ?? fallback}
        onSave={v => saveFieldLabel(key, fallback, v)}
        className="text-[13px] font-bold uppercase tracking-wider text-white text-center"
        as="span"
      />
    ) : (
      (fieldLabels[key] as string | undefined) ?? fallback
    );

  if (!details) return null;

  if (section.section_key === 'flows') {
    const rows = details?.flows?.core_flows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return (
      <ReportCoreFlowsMatrix
        rows={normalizeCoreFlowsMatrix(rows)}
        editMode={editMode}
        onUpdateNote={(rowIndex, field, value) =>
          updateCoreFlowMatrixNote(sk, rowIndex, field, value)
        }
      />
    );
  }

  if (section.section_key === 'segmentation') {
    const d = details?.segmentation;
    if (!d) return null;
    const blastRisk = Boolean(d.sends_to_full_list);
    const snapshotTitle = (rubricCfg.snapshotPanelTitle as string | undefined) ?? 'Segmentation snapshot';
    const benchmarkTitle = (rubricCfg.benchmarkPanelTitle as string | undefined) ?? 'ECD benchmark';
    return (
      <div className="mb-4 space-y-3">
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
          <RubricPanelHeader
            title={snapshotTitle}
            onSave={v => patchSectionBlock(sk, 'rubric', { snapshotPanelTitle: v || undefined })}
          />
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
          <RubricPanelHeader
            title={benchmarkTitle}
            onSave={v => patchSectionBlock(sk, 'rubric', { benchmarkPanelTitle: v || undefined })}
          />
          <div className="px-5 pt-4 pb-5">
            <EditableRubricNote
              text={d.benchmark_architecture_note || ''}
              onSave={v => updateSectionDetailField(sk, ['segmentation', 'benchmark_architecture_note'], v)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (section.section_key === 'campaigns') {
    const d = details?.campaigns;
    if (!d) return null;
    const items = [
      { key: 'cadence', label: 'Cadence', field: 'send_frequency_consistency' as const },
      { key: 'targeting', label: 'Targeting quality', field: 'segmented_vs_blast_note' as const },
      { key: 'subject', label: 'Subject / preview hygiene', field: 'subject_preview_hygiene_note' as const },
      { key: 'mix', label: 'Campaign type mix', field: 'campaign_type_mix_note' as const },
    ];
    return (
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map(({ key, label, field }) => (
          <RubricInsightCard key={key} label={editableLabel(key, label)}>
            <EditableRubricNote
              text={d[field] || ''}
              onSave={v => updateSectionDetailField(sk, ['campaigns', field], v)}
            />
          </RubricInsightCard>
        ))}
      </div>
    );
  }

  if (section.section_key === 'signup_forms') {
    const d = details?.signup_forms;
    if (!d) return null;
    const formCoverageTitle = (rubricCfg.formCoverageTitle as string | undefined) ?? 'Form coverage';
    return (
      <div className="mb-4 space-y-3">
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden card-shadow">
          <RubricPanelHeader
            title={formCoverageTitle}
            onSave={v => patchSectionBlock(sk, 'rubric', { formCoverageTitle: v || undefined })}
          />
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
          <RubricInsightCard label={editableLabel('offer', 'Offer quality')}>
            <EditableRubricNote
              text={d.offer_note || ''}
              onSave={v => updateSectionDetailField(sk, ['signup_forms', 'offer_note'], v)}
              expandable={false}
            />
          </RubricInsightCard>
          <RubricInsightCard label={editableLabel('mobile', 'Mobile optimization')}>
            <EditableRubricNote
              text={d.mobile_optimization_note || ''}
              onSave={v => updateSectionDetailField(sk, ['signup_forms', 'mobile_optimization_note'], v)}
              expandable={false}
            />
          </RubricInsightCard>
          <RubricInsightCard label={editableLabel('benchmark', 'Benchmark conversion')}>
            <EditableRubricNote
              text={d.benchmark_conversion_note || ''}
              onSave={v => updateSectionDetailField(sk, ['signup_forms', 'benchmark_conversion_note'], v)}
              expandable={false}
            />
          </RubricInsightCard>
        </div>
      </div>
    );
  }

  return null;
}

function AuditSectionKeyFindingsPanel({
  sectionKey,
  section,
  blockCfg,
  blockVisible,
}: {
  sectionKey: string;
  section: AuditSection | null | undefined;
  blockCfg?: GenericBlockConfig;
  blockVisible: boolean;
}) {
  const { editMode } = useReportEdit();
  if (!section && !editMode) return null;
  const parsed = parseSectionKeyFindings(section?.key_findings);
  const legacy = section?.human_edited_findings || section?.summary_text;
  const items = editMode
    ? normalizeWorkspaceSectionKeyFindings(parsed, legacy)
    : resolveSectionKeyFindings(parsed, legacy);
  const itemsHidden = materializeSectionKeyFindingsHidden(parsed, items.length);
  if (!blockVisible && !editMode) return null;
  if (!editMode && items.every((item, i) => !item.trim() || itemsHidden[i])) return null;

  return (
    <ReportSectionKeyFindings
      scope={{ kind: 'audit_section', sectionKey }}
      title={blockCfg?.title ?? 'Key Findings'}
      subtitle={blockCfg?.subtitle}
      items={items}
      itemsHidden={itemsHidden}
      blockHidden={blockCfg?.hidden === true}
    />
  );
}

function LayoutSectionKeyFindingsPanel({
  layoutKey,
  keyFindings,
  blockCfg,
  blockVisible,
}: {
  layoutKey: 'deliverability_snapshot' | 'attribution_model';
  keyFindings?: SectionKeyFindings;
  blockCfg?: GenericBlockConfig;
  blockVisible: boolean;
}) {
  const { editMode } = useReportEdit();
  const parsed = parseSectionKeyFindings(keyFindings);
  const items = editMode ? normalizeWorkspaceSectionKeyFindings(parsed) : resolveSectionKeyFindings(parsed);
  const itemsHidden = materializeSectionKeyFindingsHidden(parsed, items.length);
  if (!blockVisible && !editMode) return null;
  if (!editMode && items.every((item, i) => !item.trim() || itemsHidden[i])) return null;

  return (
    <ReportSectionKeyFindings
      scope={{ kind: 'layout', layoutKey }}
      title={blockCfg?.title ?? 'Key Findings'}
      subtitle={blockCfg?.subtitle}
      items={items}
      itemsHidden={itemsHidden}
      blockHidden={blockCfg?.hidden === true}
    />
  );
}

function ReportSectionBlock({
  section,
  index,
  assets,
  annotations,
  hideHeader = false,
  hideCurrentOptimized = false,
  hideRubric = false,
}: {
  section: AuditSection;
  index: number;
  assets: AuditAsset[];
  annotations: Annotation[];
  hideHeader?: boolean;
  hideCurrentOptimized?: boolean;
  hideRubric?: boolean;
}) {
  const { updateSectionField, updateSectionRevenueOpportunity, editMode } = useReportEdit();
  const sk = section.section_key;
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
          {(section.revenue_opportunity > 0 || editMode) && (
            <div className="flex items-center gap-2 shrink-0">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              <EditableCurrency
                value={section.revenue_opportunity}
                onSave={v => updateSectionRevenueOpportunity(sk, v)}
                variant="compact"
                className="text-sm font-semibold text-emerald-700"
                suffix="/mo"
                suffixClassName="text-sm font-semibold text-emerald-700"
              />
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
                  <EditablePlainText
                    value={section.current_state_title || 'Current State'}
                    onSave={v => updateSectionField(sk, 'current_state_title', v)}
                    className="text-xs font-semibold text-gray-600 uppercase tracking-wide"
                    as="span"
                  />
                </h4>
              </div>
              <div className="bg-red-50/40 border border-red-100 rounded-xl p-4 mb-4">
                <EditableRichText
                  value={section.current_state_notes || ''}
                  onSave={v => updateSectionField(sk, 'current_state_notes', v)}
                  className="text-sm text-gray-700 leading-relaxed"
                />
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
                  <EditablePlainText
                    value={section.optimized_state_title || 'Optimized State'}
                    onSave={v => updateSectionField(sk, 'optimized_state_title', v)}
                    className="text-xs font-semibold text-gray-600 uppercase tracking-wide"
                    as="span"
                  />
                </h4>
              </div>
              <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-4 mb-4">
                <EditableRichText
                  value={section.optimized_notes || ''}
                  onSave={v => updateSectionField(sk, 'optimized_notes', v)}
                  className="text-sm text-gray-700 leading-relaxed"
                />
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
      </div>
    </div>
  );
}

function EmailDesignSection({
  emailDesign,
  annotations,
  sections,
  subtitleOverride,
  benchmarkTitle,
  clientTitle,
}: {
  emailDesign: AuditEmailDesign;
  annotations: import('../lib/types').Annotation[];
  sections: AuditSection[];
  subtitleOverride?: string;
  benchmarkTitle?: string;
  clientTitle?: string;
}) {
  const { updateSectionBlockField } = useReportEdit();
  const [fullscreen, setFullscreen] = useState(false);
  const defaultSubtitle = 'Side-by-side comparison of a recent campaign email and an ECD-designed benchmark for your industry.';
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between gap-4">
        <EditablePlainText
          value={subtitleOverride ?? defaultSubtitle}
          onSave={v => updateSectionBlockField('email_design', 'comparison', 'subtitle', v)}
          className="text-sm text-gray-500 flex-1"
          as="p"
        />
        <EmailDesignFullscreenBtn onClick={() => setFullscreen(true)} />
      </div>
      <div className="p-6">
        <EmailDesignComparison
          emailDesign={emailDesign}
          annotations={annotations}
          sections={sections}
          benchmarkTitle={benchmarkTitle}
          clientTitle={clientTitle}
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
  benchmarkTitle,
  clientTitle,
  fullscreen,
  onFullscreenChange,
}: {
  emailDesign: AuditEmailDesign;
  annotations: import('../lib/types').Annotation[];
  sections: AuditSection[];
  benchmarkTitle?: string;
  clientTitle?: string;
  fullscreen: boolean;
  onFullscreenChange: (open: boolean) => void;
}) {
  const { settings } = usePlatformSettings();
  const globalAnnotationSize = settings.annotation_size;
  const globalAnnotationsExpanded = settings.annotations_expanded;

  const edSection = sections.find(s => s.section_key === 'email_design');
  const sectionAnns = edSection ? annotations.filter(a => a.audit_section_id === edSection.id) : [];
  const ecdExample = emailDesign.ecd_example;
  const { updateSectionBlockField, patchSectionBlock } = useReportEdit();

  const comparisonGrid = (maxH?: number) => (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-0">
      {emailDesign.client_email_html && (
        <div className="min-w-0 space-y-3 px-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <h4 className="text-sm font-semibold text-gray-800">
              <EditablePlainText
                value={clientTitle ?? "Client's Email"}
                onSave={v => patchSectionBlock('email_design', 'comparison', { clientTitle: v || undefined })}
                className="text-sm font-semibold text-gray-800"
                as="span"
              />
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
            <EditablePlainText
              value={benchmarkTitle ?? 'ECD Benchmark'}
              onSave={v => updateSectionBlockField('email_design', 'comparison', 'title', v)}
              className="text-sm font-semibold text-gray-800"
              as="h4"
            />
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
