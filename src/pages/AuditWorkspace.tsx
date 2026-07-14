import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ExternalLink, FileSignature, History } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import SiteFavicon from '../components/ui/SiteFavicon';
import Modal from '../components/ui/Modal';
import AuditActivityTimeline from '../components/audit/AuditActivityTimeline';
import { ReportEditProvider } from '../components/report/edit/ReportEditContext';
import WorkspacePublishBar from '../components/audit/WorkspacePublishBar';
import { mergeReportBundle, type AuditReportBundle } from '../hooks/useAuditReportData';
import { SkeletonAuditWorkspace } from '../components/ui/Skeleton';
import AuditGenerationStatus from '../components/audit/AuditGenerationStatus';
import {
  auditHasAnalysisContent,
  clearAuditGenerationActive,
  fetchAuditPipelineStatus,
  markAuditGenerationActive,
} from '../lib/audit-pipeline-status';
import type { AuditSection, Annotation, AuditEmailDesign, IndustryEmailLibrary, AuditEvent } from '../lib/types';
import type { Audit, Client } from '../lib/types';
import {
  fetchAuditReportBundleForAudit,
  fetchAuditWorkspaceShell,
  fetchWebAuditReportBundle,
  getAuditReportBundleById,
  listAuditEvents,
  listIndustryEmailLibrary,
  publishAudit,
  updateAuditStatus,
  updateAuditSection,
  type WebAuditReportBundle,
} from '../lib/db';
import { createProposalFromAudit } from '../lib/proposal-convert';
import { canSeeProposalsBeta } from '../lib/feature-flags';
import { useAuth } from '../contexts/AuthContext';
import { klaviyoScopePermissionWarnings } from '../lib/klaviyo-fetch-diagnostics';
import { lazyAuditReportView, preloadAuditReportView } from '../lib/preload-audit-report-view';
import { supabase } from '../lib/supabase';
import { scheduleSavedToast, useToast } from '../components/ui/Toast';

const AuditReportView = lazy(lazyAuditReportView);
const WebAuditReportView = lazy(() => import('../components/report/WebAuditReportView'));
const EmailDesignEditor = lazy(() => import('../components/audit/EmailDesignEditor'));
const RevenueAddOnItemsEditor = lazy(() => import('../components/audit/RevenueAddOnItemsEditor'));
const RevenueOpportunitiesDrawer = lazy(() =>
  import('../components/audit/RevenueOpportunitiesDrawer').then(module => ({
    default: module.RevenueOpportunitiesDrawer,
  })),
);
const EmailDesignDrawer = lazy(() =>
  import('../components/audit/EmailDesignEditor').then(module => ({ default: module.EmailDesignDrawer })),
);

export default function AuditWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [audit, setAudit] = useState<Audit | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sections, setSections] = useState<AuditSection[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [emailDesign, setEmailDesign] = useState<AuditEmailDesign | null>(null);
  const [emailLibrary, setEmailLibrary] = useState<IndustryEmailLibrary[]>([]);
  const [emailDesignDrawerOpen, setEmailDesignDrawerOpen] = useState(false);
  const [revenueDrawerOpen, setRevenueDrawerOpen] = useState(false);

  const saveTimers = useRef<Record<string, number>>({});
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [publishBlockedReason, setPublishBlockedReason] = useState<string>('');
  const [scopeWarnings, setScopeWarnings] = useState<string[]>([]);
  const [reportBundle, setReportBundle] = useState<AuditReportBundle | null>(null);
  const [webBundle, setWebBundle] = useState<WebAuditReportBundle | null>(null);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEvents, setActivityEvents] = useState<AuditEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const emailDesignSection = sections.find(section => section.section_key === 'email_design');

  const openActivity = async () => {
    setActivityOpen(true);
    setActivityLoading(true);
    try {
      setActivityEvents(await listAuditEvents(audit!.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    void preloadAuditReportView();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;

    const loadScopeWarnings = async (auditRow: Audit) => {
      if (auditRow.audit_method !== 'api') return;
      try {
        const { data: conn } = await supabase
          .from('klaviyo_connections')
          .select('scopes')
          .eq('client_id', auditRow.client_id)
          .maybeSingle();
        const missing = klaviyoScopePermissionWarnings(conn?.scopes as Record<string, unknown> | undefined);
        if (!cancelled && missing.length > 0) setScopeWarnings(missing);
      } catch {
        // non-critical
      }
    };

    (async () => {
      try {
        setLoading(true);
        setError('');
        setScopeWarnings([]);

        const [shell, pipeline] = await Promise.all([
          fetchAuditWorkspaceShell(id),
          fetchAuditPipelineStatus(id),
        ]);
        if (cancelled) return;
        if (!shell) throw new Error('Audit not found');

        setAudit(shell.audit);
        setClient(shell.client);
        setSections(shell.sections);

        if (shell.audit.audit_type === 'web') {
          setAnalysisInProgress(false);
          const bundle = await fetchWebAuditReportBundle(shell.audit);
          if (cancelled) return;
          if (!bundle) throw new Error('Audit not found');
          setWebBundle(bundle);
          setSections(bundle.sections);
          return;
        }

        setAnalysisInProgress(pipeline.showPipelineUi);

        if (pipeline.showPipelineUi) {
          void loadScopeWarnings(shell.audit);
          return;
        }

        clearAuditGenerationActive(id);

        const report = await fetchAuditReportBundleForAudit(shell.audit);
        if (cancelled) return;
        if (!report) throw new Error('Audit not found');

        setAudit(report.audit);
        setClient(report.client);
        setSections(report.sections);
        setAnnotations(report.annotations);
        setEmailDesign(report.emailDesign);
        setReportBundle(report as AuditReportBundle);
        void loadScopeWarnings(report.audit);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load audit');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  useEffect(() => {
    if (!emailDesignDrawerOpen || emailLibrary.length > 0) return;
    let cancelled = false;
    listIndustryEmailLibrary()
      .then(library => {
        if (!cancelled) setEmailLibrary(library);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [emailDesignDrawerOpen, emailLibrary.length]);

  const mergedReportData = useMemo(() => {
    if (!reportBundle || !audit || !client) return null;
    return mergeReportBundle(reportBundle, audit, sections, annotations, emailDesign);
  }, [reportBundle, audit, client, sections, annotations, emailDesign]);

  const hasAnalysisContent = useMemo(
    () => auditHasAnalysisContent(audit?.executive_summary, sections),
    [audit?.executive_summary, sections],
  );

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
    setSections(prev => prev.map(section => (section.id === sectionId ? { ...section, ...updates } : section)));
    if (saveTimers.current[sectionId]) window.clearTimeout(saveTimers.current[sectionId]);
    saveTimers.current[sectionId] = window.setTimeout(async () => {
      try {
        await updateAuditSection(sectionId, updates);
        scheduleSavedToast(toast);
      } catch {
        // keep UI responsive
      }
    }, 800);
  };

  const handlePublish = async () => {
    if (!audit) return;
    try {
      const updated = await publishAudit(audit.id);
      setAudit(updated);
      setPublishBlockedReason('');
      const report = await getAuditReportBundleById(audit.id);
      if (report) setReportBundle({ ...report, audit: updated, client: client ?? report.client });
    } catch (e) {
      setPublishBlockedReason(e instanceof Error ? e.message : 'Failed to publish. Please try again.');
    }
  };

  const handleStatusChange = async (newStatus: Audit['status']) => {
    if (newStatus === audit.status) return;
    try {
      const updated = await updateAuditStatus(audit.id, newStatus);
      setAudit(updated);
      if (reportBundle) {
        setReportBundle({ ...reportBundle, audit: updated, client: client ?? reportBundle.client });
      }
      toast('Status updated');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update status';
      console.error('Failed to update status:', e);
      toast(message);
    }
  };

  return (
    <ReportEditProvider
      editMode
      audit={audit}
      sections={sections}
      onAuditChange={setAudit}
      onSectionsChange={setSections}
    >
      <div className="pb-24">
        <TopBar
          title={audit.title}
          subtitle={client?.company_name}
          leadingIcon={client ? <SiteFavicon url={client.website_url} size="md" /> : undefined}
          actions={
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={openActivity}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                <History className="w-4 h-4" />
                Activity
              </button>
              {client && canSeeProposalsBeta(user?.email) ? (
                <button
                  type="button"
                  disabled={creatingProposal}
                  onClick={async () => {
                    if (!client || creatingProposal) return;
                    setCreatingProposal(true);
                    try {
                      const proposal = await createProposalFromAudit(audit, client);
                      navigate(`/proposals/${proposal.id}/edit`);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed to create proposal');
                      setCreatingProposal(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <FileSignature className="w-4 h-4" />
                  {creatingProposal ? 'Creating…' : 'Create Proposal'}
                </button>
              ) : null}
              {audit.public_share_token ? (
                <a
                  href={`/report/${audit.public_share_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Report
                </a>
              ) : null}
            </div>
          }
        />

        {scopeWarnings.length > 0 && (
          <div className="report-viewport-bleed mt-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-center text-xs text-amber-800">
            <strong>Incomplete Klaviyo data:</strong> Your API key is missing permissions for <strong>{scopeWarnings.join(', ')}</strong>.
            Regenerate the key in Klaviyo with full read access, then re-run the audit for complete data.
          </div>
        )}

        <div className="min-w-0 overflow-x-clip">
          {analysisInProgress ? (
            <div className="px-6 py-4">
              <AuditGenerationStatus
                auditId={audit.id}
                onComplete={() => {
                  setReloadKey(key => key + 1);
                }}
              />
            </div>
          ) : audit.audit_type === 'web' ? (
            <div className="report-viewport-bleed">
              {!webBundle && <SkeletonAuditWorkspace />}
              {webBundle && (
                <Suspense fallback={<SkeletonAuditWorkspace />}>
                  <WebAuditReportView data={{ ...webBundle, audit, client: client ?? webBundle.client, sections }} />
                </Suspense>
              )}
            </div>
          ) : (
            <div className="report-viewport-bleed">
              {!mergedReportData && <SkeletonAuditWorkspace />}
              {mergedReportData && (
                <Suspense fallback={<SkeletonAuditWorkspace />}>
                  <AuditReportView
                    data={mergedReportData}
                    onManageEmailDesign={() => setEmailDesignDrawerOpen(true)}
                    onManageRevenueOpportunities={() => setRevenueDrawerOpen(true)}
                  />
                </Suspense>
              )}
            </div>
          )}
        </div>

        <WorkspacePublishBar
          audit={audit}
          shareToken={audit.public_share_token}
          onPublish={handlePublish}
          onStatusChange={handleStatusChange}
          publishDisabled={audit.audit_method === 'api' && audit.status !== 'published' && Boolean(publishBlockedReason)}
          publishDisabledReason={publishBlockedReason || undefined}
        />

        {emailDesignDrawerOpen && (
          <Suspense fallback={null}>
            <EmailDesignDrawer
              open={emailDesignDrawerOpen}
              onClose={() => setEmailDesignDrawerOpen(false)}
            >
              <EmailDesignEditor
                audit={audit}
                emailDesign={emailDesign}
                emailLibrary={emailLibrary}
                annotations={annotations}
                section={emailDesignSection ?? null}
                onAnnotationsChange={setAnnotations}
                onEmailDesignChange={setEmailDesign}
                onSectionUpdate={
                  emailDesignSection
                    ? updates => handleSectionUpdate(emailDesignSection.id, updates)
                    : undefined
                }
              />
            </EmailDesignDrawer>
          </Suspense>
        )}

        {revenueDrawerOpen && (
          <Suspense fallback={null}>
            <RevenueOpportunitiesDrawer
              open={revenueDrawerOpen}
              onClose={() => setRevenueDrawerOpen(false)}
            >
              <RevenueAddOnItemsEditor
                audit={audit}
                onAuditChange={setAudit}
                hasAnalysisContent={hasAnalysisContent}
                onHighlightRegenStart={() => {
                  markAuditGenerationActive(audit.id);
                  setAnalysisInProgress(true);
                  setRevenueDrawerOpen(false);
                }}
              />
            </RevenueOpportunitiesDrawer>
          </Suspense>
        )}

        <Modal open={activityOpen} onClose={() => setActivityOpen(false)} title="Activity">
          <div className="p-5">
            {activityLoading ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : (
              <AuditActivityTimeline events={activityEvents} />
            )}
          </div>
        </Modal>
      </div>
    </ReportEditProvider>
  );
}
