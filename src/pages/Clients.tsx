import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Users, Plus, Search, ArrowRight, Globe, Calendar } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_CLIENTS, DEMO_AUDITS } from '../lib/demo-data';
import { listAudits, listClients } from '../lib/db';
import type { Audit, Client } from '../lib/types';
import { supabase } from '../lib/supabase';

export default function Clients() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDemo, hasRole } = useAuth();
  const [search, setSearch] = useState('');

  const [clients, setClients] = useState<Client[]>(isDemo ? DEMO_CLIENTS : []);
  const [audits, setAudits] = useState<Audit[]>(isDemo ? DEMO_AUDITS : []);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (isDemo) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [c, a] = await Promise.all([listClients(), listAudits()]);
        if (cancelled) return;
        setClients(c);
        setAudits(a);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load clients');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.company_name.toLowerCase().includes(q),
    );
  }, [clients, search]);

  return (
    <div>
      <TopBar
        title="Clients"
        subtitle={`${clients.length} total clients`}
        actions={
          <button
            onClick={() => navigate('/clients/new', { state: { backgroundLocation: location } })}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>
        }
      />

      <div className="p-8 animate-fade-in">
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients by name..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">Loading clients...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Add your first client to start running audits."
            action={
              <button
                onClick={() => navigate('/clients/new', { state: { backgroundLocation: location } })}
                className="flex items-center gap-2 px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Add First Client
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(client => {
              const clientAudits = audits.filter(a => a.client_id === client.id);
              const lastAudit = clientAudits[0];
              return (
                <button
                  key={client.id}
                  onClick={() => navigate(`/clients/${client.id}`)}
                  className="bg-white rounded-xl p-5 card-shadow hover:card-shadow-hover transition-all text-left group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-brand-primary transition-colors">
                        {client.company_name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">{client.industry}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasRole('admin') && !isDemo && (
                        <button
                          type="button"
                          onClick={async e => {
                            e.stopPropagation();
                            if (!window.confirm(`Delete client \"${client.company_name}\"? This will also delete its audits.`)) return;
                            try {
                              const { data: sessionData } = await supabase.auth.getSession();
                              const token = sessionData.session?.access_token;
                              if (!token) throw new Error('Your session expired. Please sign in again and retry.');
                              const { data, error } = await supabase.functions.invoke('admin_delete_client', {
                                body: { client_id: client.id },
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              if (error) throw error;
                              if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to delete client');
                              setClients(prev => prev.filter(c => c.id !== client.id));
                              setAudits(prev => prev.filter(a => a.client_id !== client.id));
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : 'Failed to delete client');
                            }
                          }}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                          title="Delete client"
                        >
                          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M6 6l1 16h10l1-16" />
                          </svg>
                        </button>
                      )}
                      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-primary transition-colors" />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Globe className="w-3.5 h-3.5" />
                      <span className="truncate">{client.website_url || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{new Date(client.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {clientAudits.length} audit{clientAudits.length !== 1 ? 's' : ''}
                    </span>
                    {lastAudit && (
                      <span className="text-xs text-gray-400">
                        Last: {new Date(lastAudit.updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
