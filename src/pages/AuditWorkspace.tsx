import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ExternalLink, FileSignature, History, Loader2, Sparkles } from 'lucide-react';
import AuditContextAssistant from '../components/audit/AuditContextAssistant';
import WebAuditAgentPanel from '../components/audit/WebAuditAgentPanel';
import { runKlaviyoAudit, runWebAudit } from '../lib/audit-run';
import type { AuditContextDraft } from '../lib/audit-context-agent';
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
import { fetchWebAuditPipelineStatus, startWebAnalysis } from '../lib/web-pipeline-status';
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
  updateAudit,
  updateAuditStatus,
  updateAuditSection,
  listAuditSections,
  type WebAuditReportBundle,
} from '../lib/db';
import { createProposalFromAudit } from '../lib/proposal-convert';
import { canSeeProposalsBeta } from '../lib/feature-flags';
import { useAuth } from '../contexts/AuthContext';
import { canUseWebAudits } from '../lib/web-audit-access';
import { klaviyoScopePermissionWarnings } from '../lib/klaviyo-fetch-diagnostics';
import { lazyAuditReportView, preloadAuditReportView } from '../lib/preload-audit-report-view';
import { supabase } from '../lib/supabase';
import { scheduleSavedToast, useToast } from '../components/ui/Toast';

const AuditReportView = lazy(lazyAuditReportView);
const WebAuditReportView = lazy(() => import('../components/report/WebAuditReportView'));
const WebAuditGenerationStatus = lazy(() => import('../components/audit/WebAuditGenerationStatus'));
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
  // Pulse the context assistant on first landing to draw focus; stop once the
  // strategist interacts with it.
  const [assistantTouched, setAssistantTouched] = useState(false);

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
  const [webGenerating, setWebGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Draft audits are created by the wizard and run from here.
  const location = useLocation();
  const oneTimeKlaviyoKey = (location.state as { klaviyoApiKey?: string } | null)?.klaviyoApiKey;
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ progress: number; stage: string }>({ progress: 0, stage: '' });
  // Draws attention to the Run button after the assistant's context is applied.
  const [contextApplied, setContextApplied] = useState(false);
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
          const webStatus = await fetchWebAuditPipelineStatus(id);
          if (cancelled) return;
          if (webStatus.exists && !webStatus.complete) {
            setWebGenerating(true);
            return;
          }
          setWebGenerating(false);
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

  // Web audits are locked to the allowlist while the feature is a work in progress.
  if (audit.audit_type === 'web' && !canUseWebAudits(user)) {
    return (
      <div>
        <TopBar title="Web Audit" />
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Work in progress
          </span>
          <p className="mt-3 text-sm text-amber-900">Web audits are still being built and are not available yet.</p>
          <button onClick={() => navigate('/audits')} className="mt-4 text-sm text-brand-primary font-medium hover:underline">
            Back to Audits
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

  // A freshly-created draft that has not been run yet: show the pre-run screen
  // (context assistant + Run button) instead of an empty report.
  const preRun =
    audit.status === 'draft' && !hasAnalysisContent && !analysisInProgress && !webGenerating && !regenerating;

  const runDraft = async () => {
    if (running || !audit) return;
    setRunning(true);
    setContextApplied(false);
    setError('');
    setRunProgress({ progress: 5, stage: 'Starting…' });
    markAuditGenerationActive(audit.id);
    try {
      const onProgress = (progress: number, stage: string) => setRunProgress({ progress, stage });
      if (audit.audit_type === 'web') {
        await runWebAudit(audit.id, audit.client_id, { websiteUrl: client?.website_url ?? '', onProgress });
      } else {
        await runKlaviyoAudit(audit.id, audit.client_id, { apiKey: oneTimeKlaviyoKey, onProgress });
      }
      clearAuditGenerationActive(audit.id);
      setReloadKey(key => key + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The audit run failed. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const applyContextDraft = async (draft: AuditContextDraft) => {
    if (!audit) return;
    const nextContext = {
      ...(audit.context ?? {}),
      client_background: draft.client_background || audit.context?.client_background,
      custom_instructions: draft.custom_instructions || audit.context?.custom_instructions,
      sells_subscriptions: draft.sells_subscriptions || audit.context?.sells_subscriptions,
    };
    try {
      const updated = await updateAudit(audit.id, { context: nextContext });
      setAudit(updated);
      setContextApplied(true);
      toast('Context saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save context');
    }
  };

  const applyTranscript = async (notes: string) => {
    if (!audit) return;
    const nextContext = { ...(audit.context ?? {}), meeting_notes: notes };
    try {
      const updated = await updateAudit(audit.id, { context: nextContext });
      setAudit(updated);
    } catch { /* non-fatal */ }
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
              {audit.audit_type === 'web' && !webGenerating && (
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={async () => {
                    if (!window.confirm('Regenerate the AI analysis? This replaces the current findings, recommendations, and roadmap (your manual edits to them will be lost).')) return;
                    setRegenerating(true);
                    try {
                      await startWebAnalysis(audit.id, 'regenerate');
                      setWebGenerating(true);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Failed to start analysis');
                    } finally {
                      setRegenerating(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {regenerating ? 'Starting…' : 'Regenerate analysis'}
                </button>
              )}
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
          {running ? (
            <div className="mx-auto max-w-md px-6 py-16 text-center">
              <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-brand-primary" />
              <h2 className="mb-2 text-xl font-bold text-gray-900">
                {audit.audit_type === 'web' ? 'Building web audit…' : 'Analyzing account…'}
              </h2>
              <p className="mb-4 text-sm text-gray-500">{runProgress.stage || 'Working…'}</p>
              <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
                <div className="h-full gradient-bg rounded-full transition-all duration-500" style={{ width: `${runProgress.progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Analysis continues on the server; you can leave this page and reopen the audit anytime.
              </p>
            </div>
          ) : preRun ? (
            <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 p-6 pb-28 lg:grid-cols-[1fr_400px]">
              {/* Left: finalize + run */}
              <div className="space-y-4">
                <div className="rounded-xl bg-white p-6 card-shadow">
                  <h2 className="text-lg font-semibold text-gray-900">Finalize &amp; run</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Use the assistant to capture the client context, then run the audit when you're ready.
                  </p>
                  {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}
                  <button
                    type="button"
                    onClick={runDraft}
                    className={`mt-4 inline-flex items-center gap-2 rounded-lg gradient-bg px-6 py-3 text-sm font-semibold text-white transition-shadow hover:opacity-90 ${contextApplied ? 'animate-pulse ring-4 ring-brand-primary/30' : ''}`}
                  >
                    <Sparkles className="h-4 w-4" />
                    {audit.audit_type === 'web' ? 'Capture & analyze' : 'Run analysis'}
                  </button>
                  {contextApplied && (
                    <p className="mt-2 text-xs font-medium text-brand-primary">Context applied. Run the audit when you're ready.</p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">You can also run it now and add context later.</p>
                </div>

                <div className="rounded-xl bg-white p-6 card-shadow">
                  <h3 className="text-sm font-semibold text-gray-900">Captured context</h3>
                  {(audit.context?.client_background?.trim() || audit.context?.custom_instructions?.trim()) ? (
                    <div className="mt-3 space-y-4 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Client background</p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-700">{audit.context?.client_background || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Audit focus areas</p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-700">{audit.context?.custom_instructions || '—'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-gray-400">Chat with the assistant to capture the client background and audit focus areas.</p>
                  )}
                </div>
              </div>

              {/* Right: docked context assistant. Height tracks the viewport (so
                  the input stays visible when zoomed) but caps at 600px. */}
              <div className="relative h-[min(600px,calc(100dvh-13rem))] min-h-[360px] lg:sticky lg:top-6">
                {!assistantTouched && (
                  <div className="pointer-events-none absolute -inset-1 z-10 animate-pulse rounded-2xl ring-4 ring-brand-primary/40" />
                )}
                <AuditContextAssistant
                  onFirstInteraction={() => setAssistantTouched(true)}
                  onApply={applyContextDraft}
                  onTranscript={applyTranscript}
                  getSnapshot={() => ({
                    client_name: client?.name,
                    company_name: client?.company_name,
                    website_url: client?.website_url,
                    audit_type: audit.audit_type ?? 'klaviyo',
                    meeting_notes: audit.context?.meeting_notes,
                    client_background: audit.context?.client_background,
                    custom_instructions: audit.context?.custom_instructions,
                  })}
                />
              </div>
            </div>
          ) : analysisInProgress ? (
            <div className="px-6 py-4">
              <AuditGenerationStatus
                auditId={audit.id}
                onComplete={() => {
                  setReloadKey(key => key + 1);
                }}
              />
            </div>
          ) : audit.audit_type === 'web' ? (
            webGenerating ? (
              <div className="px-6 py-4">
                <Suspense fallback={<SkeletonAuditWorkspace />}>
                  <WebAuditGenerationStatus auditId={audit.id} onComplete={() => setReloadKey(key => key + 1)} />
                </Suspense>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[77rem]">
                {!webBundle && <SkeletonAuditWorkspace />}
                {webBundle && (
                  <Suspense fallback={<SkeletonAuditWorkspace />}>
                    <WebAuditReportView data={{ ...webBundle, audit, client: client ?? webBundle.client, sections }} />
                  </Suspense>
                )}
              </div>
            )
          ) : (
            <div className="mx-auto w-full max-w-[80rem] 2xl:max-w-[90rem]">
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

        {audit.audit_type === 'web' && !webGenerating && webBundle && (
          <WebAuditAgentPanel
            auditId={audit.id}
            sections={sections}
            onReload={() => { if (id) listAuditSections(id).then(setSections).catch(() => {}); }}
          />
        )}
      </div>
    </ReportEditProvider>
  );
}
