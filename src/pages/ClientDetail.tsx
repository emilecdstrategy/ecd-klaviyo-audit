import { useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Globe,
  Mail,
  FileText,
  Plus,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  KeyRound,
  Trash2,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import { SkeletonClientDetail } from '../components/ui/Skeleton';
import { IndustrySelectWithCustom } from '../components/ui/IndustrySelect';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../lib/revenue-calculator';
import { useEffect, useState } from 'react';
import type { Audit, Client } from '../lib/types';
import { getClient, listAuditsByClient, updateClient } from '../lib/db';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import { KlaviyoApiKeyHelpTrigger } from '../components/klaviyo/KlaviyoApiKeyHelpModal';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();

  const [client, setClient] = useState<Client | null>(null);
  const [clientAudits, setClientAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAudit, setDeletingAudit] = useState<Audit | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [c, a] = await Promise.all([getClient(id), listAuditsByClient(id)]);
        if (cancelled) return;
        setClient(c);
        setClientAudits(a);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load client');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div>
        <TopBar title="Client" />
        <SkeletonClientDetail />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <TopBar title="Client" />
        <div className="p-8">
          <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
          <button
            onClick={() => navigate('/clients')}
            className="mt-4 text-sm text-brand-primary font-medium hover:underline"
          >
            Back to Clients
          </button>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div>
        <TopBar title="Client Not Found" />
        <div className="p-8 text-center">
          <p className="text-gray-500">This client could not be found.</p>
          <button
            onClick={() => navigate('/clients')}
            className="mt-4 text-sm text-brand-primary font-medium hover:underline"
          >
            Back to Clients
          </button>
        </div>
      </div>
    );
  }

  const hasApiConnection = Boolean((client as any).klaviyo_connected);

  const handleSaveApiKey = async () => {
    if (!client || !newApiKey.trim()) return;
    setKeySaving(true);
    setKeyMsg(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Session expired. Please sign in again.');
      const { data, error: fnErr } = await supabase.functions.invoke('klaviyo_connect_client', {
        body: { client_id: client.id, api_key: newApiKey.trim() },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (fnErr) throw fnErr;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to connect Klaviyo');
      setKeyMsg({ ok: true, text: 'API key updated successfully.' });
      setEditingKey(false);
      setNewApiKey('');
      setClient(prev => prev ? { ...prev, klaviyo_connected: true } as any : prev);
    } catch (e: unknown) {
      setKeyMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to update API key' });
    } finally {
      setKeySaving(false);
    }
  };
  const firstAuditDate = clientAudits.length
    ? new Date(
      clientAudits
        .map(a => new Date(a.created_at).getTime())
        .reduce((min, t) => Math.min(min, t), Infinity),
    ).toLocaleDateString()
    : '—';

  return (
    <div>
      <TopBar
        title={client.company_name}
        subtitle={client.website_url || ' '}
        actions={
          <button
            onClick={() => navigate('/audits/new', { state: { clientId: client.id, backgroundLocation: location } })}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Audit
          </button>
        }
      />
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
                  setClientAudits(prev => prev.filter(a => a.id !== deletingAudit.id));
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

      <div className="p-8 animate-fade-in">
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Clients
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl p-6 card-shadow">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Client Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Company</p>
                  <p className="text-sm text-gray-900">{client.company_name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">ESP Platform</p>
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    <p className="text-sm text-gray-900">{client.esp_platform}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Industry</p>
                  <IndustrySelectWithCustom
                    value={client.industry || ''}
                    onValueChange={async (v) => {
                      setClient(prev => prev ? { ...prev, industry: v } : prev);
                      try { await updateClient(client.id, { industry: v }); } catch { /* ignore */ }
                    }}
                    iconSize="sm"
                    triggerClassName="h-8 text-sm w-full max-w-[200px]"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Website</p>
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-gray-400" />
                    {client.website_url ? (
                      <a
                        href={client.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand-primary hover:underline"
                      >
                        {client.website_url}
                      </a>
                    ) : (
                      <p className="text-sm text-gray-500">Not provided</p>
                    )}
                  </div>
                </div>
              </div>
              {client.notes && (
                <div className="mt-4 pt-4 border-t border-gray-50">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{client.notes}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl card-shadow">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Audit History</h2>
                <span className="text-xs text-gray-400">{clientAudits.length} audits</span>
              </div>
              {clientAudits.length === 0 ? (
                <div className="p-8 text-center">
                  <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No audits yet for this client.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {clientAudits.map(audit => (
                    <div
                      key={audit.id}
                      onClick={() => navigate(`/audits/${audit.id}`)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(audit.created_at).toLocaleDateString()} &middot; {audit.audit_method === 'api' ? 'API Connected' : 'Screenshot Based'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(audit.total_revenue_opportunity)}
                        </span>
                        <StatusBadge status={audit.status} />
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
                        <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl p-5 card-shadow">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <h3 className="text-sm font-semibold text-gray-900">API Connection</h3>
                <KlaviyoApiKeyHelpTrigger className="inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-medium text-brand-primary transition-colors hover:text-brand-primary-dark hover:underline" />
              </div>
              <div className="flex items-center gap-2 mb-3">
                {hasApiConnection ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm text-emerald-700 font-medium">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-gray-300" />
                    <span className="text-sm text-gray-500">Not Connected</span>
                  </>
                )}
              </div>

              {keyMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg mb-3 ${keyMsg.ok ? 'text-emerald-700 bg-emerald-50 border border-emerald-100' : 'text-red-700 bg-red-50 border border-red-100'}`}>
                  {keyMsg.text}
                </div>
              )}

              {editingKey ? (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={newApiKey}
                    onChange={e => setNewApiKey(e.target.value)}
                    placeholder="pk_..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveApiKey}
                      disabled={keySaving || !newApiKey.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 gradient-bg text-white text-xs font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {keySaving && <Loader2 className="w-3 h-3 animate-spin" />}
                      {keySaving ? 'Saving...' : 'Save Key'}
                    </button>
                    <button
                      onClick={() => { setEditingKey(false); setNewApiKey(''); setKeyMsg(null); }}
                      disabled={keySaving}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingKey(true); setKeyMsg(null); }}
                  className="flex items-center gap-1.5 text-xs text-brand-primary font-medium hover:underline"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {hasApiConnection ? 'Update API Key' : 'Connect API Key'}
                </button>
              )}
            </div>

            <div className="bg-white rounded-xl p-5 card-shadow">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Stats</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total Audits</span>
                  <span className="text-sm font-semibold text-gray-900">{clientAudits.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total Rev Opportunity</span>
                  <span className="text-sm font-semibold text-emerald-700">
                    {formatCurrency(clientAudits.reduce((s, a) => s + a.total_revenue_opportunity, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">First Audit</span>
                  <span className="text-sm text-gray-900">
                    {firstAuditDate}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
