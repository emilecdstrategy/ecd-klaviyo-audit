import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Globe,
  Mail,
  FileText,
  Plus,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_CLIENTS, DEMO_AUDITS } from '../lib/demo-data';
import { formatCurrency } from '../lib/revenue-calculator';
import { useEffect, useState } from 'react';
import type { Audit, Client } from '../lib/types';
import { getClient, listAuditsByClient } from '../lib/db';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isDemo } = useAuth();

  const [client, setClient] = useState<Client | null>(
    isDemo ? (DEMO_CLIENTS.find(c => c.id === id) ?? null) : null,
  );
  const [clientAudits, setClientAudits] = useState<Audit[]>(
    isDemo ? DEMO_AUDITS.filter(a => a.client_id === id) : [],
  );
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (isDemo || !id) return;
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
  }, [id, isDemo]);

  if (loading) {
    return (
      <div>
        <TopBar title="Client" />
        <div className="p-8 text-sm text-gray-500">Loading client...</div>
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
        subtitle={client.industry}
        actions={
          <button
            onClick={() => navigate('/audits/new', { state: { clientId: client.id } })}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Audit
          </button>
        }
      />

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
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Industry</p>
                  <p className="text-sm text-gray-900">{client.industry}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">ESP Platform</p>
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    <p className="text-sm text-gray-900">{client.esp_platform}</p>
                  </div>
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
                    <button
                      key={audit.id}
                      onClick={() => navigate(`/audits/${audit.id}`)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(audit.created_at).toLocaleDateString()} &middot; {audit.audit_method === 'api' ? 'API Connected' : 'Screenshot Based'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 ml-4">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(audit.total_revenue_opportunity)}
                        </span>
                        <StatusBadge status={audit.status} />
                        <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl p-5 card-shadow">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">API Connection</h3>
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
              {!hasApiConnection && (
                <p className="text-xs text-gray-400">
                  Connect a Klaviyo private API key during an API-based audit to enable automated analysis.
                </p>
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
