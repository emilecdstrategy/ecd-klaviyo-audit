import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import AuditReportView from '../components/report/AuditReportView';
import { ReportEditProvider } from '../components/report/edit/ReportEditContext';
import EmailDesignEditor, { EmailDesignDrawer } from '../components/audit/EmailDesignEditor';
import RevenueAddOnItemsEditor from '../components/audit/RevenueAddOnItemsEditor';
import WorkspacePublishBar from '../components/audit/WorkspacePublishBar';
import { mergeReportBundle, type AuditReportBundle } from '../hooks/useAuditReportData';
import { SkeletonAuditWorkspace } from '../components/ui/Skeleton';
import type { AuditSection, Annotation, AuditEmailDesign, IndustryEmailLibrary } from '../lib/types';
import type { Audit, AuditAsset, Client } from '../lib/types';
import {
  getAudit,
  getClient,
  getAuditReportBundleById,
  listAnnotationsForAuditSections,
  listAssets,
  listAuditSections,
  publishAudit,
  updateAuditStatus,
  updateAuditSection,
  getAuditEmailDesign,
  listIndustryEmailLibrary,
} from '../lib/db';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/ui/Toast';

function WorkspaceSaveStatus() {
  const { saveStatus } = useReportEdit();
  if (saveStatus === 'idle') return null;
  return (
    <span className={`text-xs ${saveStatus === 'error' ? 'text-red-600' : saveStatus === 'saved' ? 'text-emerald-600' : 'text-gray-500'}`}>
      {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
    </span>
  );
}

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

  const [emailDesign, setEmailDesign] = useState<AuditEmailDesign | null>(null);
  const [emailLibrary, setEmailLibrary] = useState<IndustryEmailLibrary[]>([]);
  const [emailDesignDrawerOpen, setEmailDesignDrawerOpen] = useState(false);
  const [revenueDrawerOpen, setRevenueDrawerOpen] = useState(false);

  const saveTimers = useRef<Record<string, number>>({});
  const [publishBlockedReason, setPublishBlockedReason] = useState<string>('');
  const [scopeWarnings, setScopeWarnings] = useState<string[]>([]);
  const [reportBundle, setReportBundle] = useState<AuditReportBundle | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const emailDesignSection = sections.find(s => s.section_key === 'email_design');

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
    if (!audit?.id) return;
    let cancelled = false;
    (async () => {
      try {
        setReportLoading(true);
        const report = await getAuditReportBundleById(audit.id);
        if (!cancelled && report) {
          setReportBundle({
            ...report,
            audit,
            client: client ?? report.client,
          } as AuditReportBundle);
        }
      } catch {
        if (!cancelled) setReportBundle(null);
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audit?.id, client]);

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
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, ...updates } : s)));
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
    try {
      const updated = await updateAuditStatus(audit.id, newStatus);
      setAudit(updated);
      toast('Status updated');
    } catch (e) {
      console.error('Failed to update status:', e);
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
          actions={
            <div className="flex items-center gap-3">
              {audit.public_share_token ? (
                <a
                  href={`/report/${audit.public_share_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Report
                </a>
              ) : null}
            </div>
          }
        />

        {scopeWarnings.length > 0 && (
          <div className="mx-6 mt-3 px-4 py-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
            <strong>Incomplete Klaviyo data:</strong> Your API key is missing permissions for <strong>{scopeWarnings.join(', ')}</strong>.
            Regenerate the key in Klaviyo with full read access, then re-run the audit for complete data.
          </div>
        )}

        <div className="min-w-0">
          {(reportLoading || !mergedReportData) && <SkeletonAuditWorkspace />}
          {!reportLoading && mergedReportData && (
            <AuditReportView
              data={mergedReportData}
              onManageEmailDesign={() => setEmailDesignDrawerOpen(true)}
              onManageRevenueOpportunities={() => setRevenueDrawerOpen(true)}
            />
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

        <EmailDesignDrawer open={emailDesignDrawerOpen} onClose={() => setEmailDesignDrawerOpen(false)}>
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

        <EmailDesignDrawer
          open={revenueDrawerOpen}
          onClose={() => setRevenueDrawerOpen(false)}
          title="Revenue opportunities"
        >
          <RevenueAddOnItemsEditor audit={audit} onAuditChange={setAudit} />
        </EmailDesignDrawer>
      </div>
    </ReportEditProvider>
  );
}
