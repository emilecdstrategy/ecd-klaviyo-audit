import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import SiteFavicon from '../components/ui/SiteFavicon';
import { ReportEditProvider } from '../components/report/edit/ReportEditContext';
import WorkspacePublishBar from '../components/audit/WorkspacePublishBar';
import { mergeReportBundle, type AuditReportBundle } from '../hooks/useAuditReportData';
import { SkeletonAuditWorkspace } from '../components/ui/Skeleton';
import AuditGenerationStatus from '../components/audit/AuditGenerationStatus';
import {
  clearAuditGenerationActive,
  fetchAuditPipelineStatus,
  regenerateAuditForHighlights,
} from '../lib/audit-pipeline-status';
import AddOnHighlightRegenModal from '../components/audit/AddOnHighlightRegenModal';
import type { AuditSection, Annotation, AuditEmailDesign, IndustryEmailLibrary } from '../lib/types';
import type { Audit, Client } from '../lib/types';
import {
  getAuditReportBundleById,
  listIndustryEmailLibrary,
  publishAudit,
  updateAuditStatus,
  updateAuditSection,
} from '../lib/db';
import { supabase } from '../lib/supabase';
import { scheduleSavedToast, useToast } from '../components/ui/Toast';

const AuditReportView = lazy(() => import('../components/report/AuditReportView'));
const EmailDesignEditor = lazy(() => import('../components/audit/EmailDesignEditor'));
const RevenueAddOnItemsEditor = lazy(() => import('../components/audit/RevenueAddOnItemsEditor'));
const EmailDesignDrawer = lazy(() =>
  import('../components/audit/EmailDesignEditor').then(module => ({ default: module.EmailDesignDrawer })),
);

export default function AuditWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

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
  const [publishBlockedReason, setPublishBlockedReason] = useState<string>('');
  const [scopeWarnings, setScopeWarnings] = useState<string[]>([]);
  const [reportBundle, setReportBundle] = useState<AuditReportBundle | null>(null);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [highlightRegenOpen, setHighlightRegenOpen] = useState(false);
  const [highlightRegenRunning, setHighlightRegenRunning] = useState(false);

  const emailDesignSection = sections.find(section => section.section_key === 'email_design');

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const report = await getAuditReportBundleById(id);
        if (cancelled) return;
        if (!report) throw new Error('Audit not found');

        setAudit(report.audit);
        setClient(report.client);
        setSections(report.sections);
        setAnnotations(report.annotations);
        setEmailDesign(report.emailDesign);
        setReportBundle(report as AuditReportBundle);

        const pipeline = await fetchAuditPipelineStatus(id);
        if (!cancelled) {
          setAnalysisInProgress(pipeline.showPipelineUi);
          if (!pipeline.showPipelineUi) clearAuditGenerationActive(id);
        }

        if (report.audit.audit_method === 'api') {
          try {
            const { data: conn } = await supabase
              .from('klaviyo_connections')
              .select('scopes')
              .eq('client_id', report.audit.client_id)
              .maybeSingle();
            if (conn?.scopes) {
              const missing = Object.entries(conn.scopes as Record<string, unknown>)
                .filter(([, value]) => value !== true)
                .map(([key]) => key);
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
              revenueValue={emailDesignSection?.revenue_opportunity}
              onRevenueChange={
                emailDesignSection
                  ? value => handleSectionUpdate(emailDesignSection.id, { revenue_opportunity: value })
                  : undefined
              }
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
            <EmailDesignDrawer
              open={revenueDrawerOpen}
              onClose={() => setRevenueDrawerOpen(false)}
              title="Revenue opportunities"
            >
              <RevenueAddOnItemsEditor
                audit={audit}
                onAuditChange={setAudit}
                onHighlightChanged={() => setHighlightRegenOpen(true)}
              />
            </EmailDesignDrawer>
          </Suspense>
        )}
        <AddOnHighlightRegenModal
          open={highlightRegenOpen}
          running={highlightRegenRunning}
          onDismiss={() => setHighlightRegenOpen(false)}
          onConfirm={async () => {
            if (!audit?.id) return;
            setHighlightRegenRunning(true);
            try {
              await regenerateAuditForHighlights(audit.id);
              setHighlightRegenOpen(false);
              setAnalysisInProgress(true);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Regeneration failed');
            } finally {
              setHighlightRegenRunning(false);
            }
          }}
        />
      </div>
    </ReportEditProvider>
  );
}
