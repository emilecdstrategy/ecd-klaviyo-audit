import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ClipboardCheck,
  ExternalLink,
  Filter,
  Trash2,
  Palette,
  BarChart3,
  Workflow,
  Image as ImageIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import SiteFavicon from '../components/ui/SiteFavicon';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonTable } from '../components/ui/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../lib/revenue-calculator';
import { isLikelyAuditGenerating } from '../lib/audit-pipeline-status';
import { listAudits, listClients } from '../lib/db';
import GeneratingBadge from '../components/ui/GeneratingBadge';
import { useEffect } from 'react';
import type { Audit, Client } from '../lib/types';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../components/ui/select';
import Modal from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import PlatformReportSettingsPanel from '../components/admin/PlatformReportSettingsPanel';
import BenchmarkSettingsPanel from '../components/admin/BenchmarkSettingsPanel';
import CoreFlowStandardsPanel from '../components/admin/CoreFlowStandardsPanel';
import EmailLibraryPanel from '../components/admin/EmailLibraryPanel';

const TABS = [
  { id: 'overview', label: 'Audits', icon: ClipboardCheck, adminOnly: false },
  { id: 'report_display', label: 'Report Display', icon: Palette, adminOnly: true },
  { id: 'klaviyo_benchmarks', label: 'Klaviyo Benchmarks', icon: BarChart3, adminOnly: true },
  { id: 'core_flow_standards', label: 'Core Flow Standards', icon: Workflow, adminOnly: true },
  { id: 'email_library', label: 'Email Library', icon: ImageIcon, adminOnly: true },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Audits() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const availableTabs = TABS.filter(t => !t.adminOnly || isAdmin);
  const tab: TabId = availableTabs.some(t => t.id === tabParam) ? (tabParam as TabId) : 'overview';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('__all__');

  const [audits, setAudits] = useState<Audit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAudit, setDeletingAudit] = useState<Audit | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [a, c] = await Promise.all([listAudits(), listClients()]);
        if (cancelled) return;
        setAudits(a);
        setClients(c);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load audits');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  const filtered = audits.filter(a => {
    const client = clientById.get(a.client_id);
    const matchSearch =
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      (client?.company_name || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === '__all__' || !statusFilter || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <TopBar
        title="Audits"
        subtitle={`${audits.length} total audits`}
        actions={
          tab === 'overview' ? (
            <button
              onClick={() => navigate('/audits/new', { state: { backgroundLocation: location } })}
              className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              New Audit
            </button>
          ) : undefined
        }
      />

      <div className="p-8 animate-fade-in">
        {availableTabs.length > 1 && (
          <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
            {availableTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setSearchParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'report_display' && <PlatformReportSettingsPanel />}
        {tab === 'klaviyo_benchmarks' && <BenchmarkSettingsPanel />}
        {tab === 'core_flow_standards' && <CoreFlowStandardsPanel />}
        {tab === 'email_library' && <EmailLibraryPanel />}

        {tab === 'overview' && (
        <>
        <Modal
          open={deleteConfirmOpen}
          title="Delete audit?"
          onClose={() => {
            if (deleting) return;
            setDeleteConfirmOpen(false);
            setDeletingAudit(null);
          }}
          className="max-w-lg"
        >
          <div className="p-5">
            <p className="text-sm text-gray-700">
              {deletingAudit
                ? `Delete “${deletingAudit.title}”? This action cannot be undone.`
                : 'Delete this audit? This action cannot be undone.'}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  setDeletingAudit(null);
                }}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || !deletingAudit}
                onClick={async () => {
                  if (!deletingAudit) return;
                  try {
                    setDeleting(true);
                    const { data, error: fnError } = await supabase.functions.invoke('admin_delete_audit', {
                      body: { audit_id: deletingAudit.id },
                    });
                    if (fnError) throw fnError;
                    if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to delete audit');
                    setAudits(prev => prev.filter(a => a.id !== deletingAudit.id));
                    setDeleteConfirmOpen(false);
                    setDeletingAudit(null);
                  } catch (err: unknown) {
                    alert(err instanceof Error ? err.message : 'Failed to delete audit');
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : 'Delete audit'}
              </button>
            </div>
          </div>
        </Modal>

        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search audits..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <div className="relative">
            <Filter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <div className="min-w-[160px]">
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
                <SelectTrigger className="pl-9">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__"><SelectItemText>All</SelectItemText></SelectItem>
                  <SelectItem value="draft"><SelectItemText>Draft</SelectItemText></SelectItem>
                  <SelectItem value="in_review"><SelectItemText>In Review</SelectItemText></SelectItem>
                  <SelectItem value="viewer_only"><SelectItemText>Viewer Only</SelectItemText></SelectItem>
                  <SelectItem value="published"><SelectItemText>Published</SelectItemText></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <SkeletonTable rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No audits found"
            description="Create your first audit to start identifying revenue opportunities."
            action={
              <button
                onClick={() => navigate('/audits/new', { state: { backgroundLocation: location } })}
                className="flex items-center gap-2 px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Start First Audit
              </button>
            }
          />
        ) : (
          <div className="bg-white rounded-xl card-shadow overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Audit</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Client</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Revenue Opp.</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Date</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(audit => {
                  const client = clientById.get(audit.client_id);
                  return (
                    <tr
                      key={audit.id}
                      onClick={() => navigate(`/audits/${audit.id}`)}
                      className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.title}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <SiteFavicon url={client?.website_url} />
                          <span className="text-sm text-gray-600 truncate">{client?.company_name || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(audit.total_revenue_opportunity)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={audit.status} />
                          {isLikelyAuditGenerating(audit) && <GeneratingBadge />}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">
                        {new Date(audit.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {audit.public_share_token && (
                            <a
                              href={`/report/${audit.public_share_token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="p-1.5 rounded hover:bg-gray-100 transition-colors inline-flex"
                              title="Open public report in new tab"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                            </a>
                          )}
                          {hasRole('admin') && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setDeletingAudit(audit);
                                setDeleteConfirmOpen(true);
                              }}
                              className="p-1.5 rounded hover:bg-red-50 transition-colors"
                              title="Delete audit"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-600" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
