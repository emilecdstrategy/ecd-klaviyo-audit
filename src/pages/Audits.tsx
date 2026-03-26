import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  ClipboardCheck,
  ExternalLink,
  Filter,
} from 'lucide-react';
import { useState } from 'react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_AUDITS, DEMO_CLIENTS } from '../lib/demo-data';
import { formatCurrency } from '../lib/revenue-calculator';
import { listAudits, listClients } from '../lib/db';
import { useEffect } from 'react';
import type { Audit, Client } from '../lib/types';

export default function Audits() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [audits, setAudits] = useState<Audit[]>(isDemo ? DEMO_AUDITS : []);
  const [clients, setClients] = useState<Client[]>(isDemo ? DEMO_CLIENTS : []);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (isDemo) return;
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
  }, [isDemo]);

  const filtered = audits.filter(a => {
    const client = clients.find(c => c.id === a.client_id);
    const matchSearch =
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      (client?.company_name || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <TopBar
        title="Audits"
        subtitle={`${audits.length} total audits`}
        actions={
          <button
            onClick={() => navigate('/audits/new')}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Audit
          </button>
        }
      />

      <div className="p-8 animate-fade-in">
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
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2.5 bg-white border border-gray-200 rounded-lg text-sm appearance-none focus:outline-none focus:border-brand-primary"
            >
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="in_progress">In Progress</option>
              <option value="review">In Review</option>
              <option value="completed">Completed</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">Loading audits...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No audits found"
            description="Create your first audit to start identifying revenue opportunities."
            action={
              <button
                onClick={() => navigate('/audits/new')}
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
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Method</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Revenue Opp.</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Date</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(audit => {
                  const client = clients.find(c => c.id === audit.client_id);
                  return (
                    <tr
                      key={audit.id}
                      onClick={() => navigate(`/audits/${audit.id}`)}
                      className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{audit.title}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {client?.company_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-medium text-gray-500 capitalize">{audit.audit_method}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(audit.total_revenue_opportunity)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={audit.status} />
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">
                        {new Date(audit.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        {audit.public_share_token && (
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/report/${audit.public_share_token}`); }}
                            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
