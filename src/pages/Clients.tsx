import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Search, ArrowRight, Globe, Calendar } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_CLIENTS, DEMO_AUDITS } from '../lib/demo-data';

export default function Clients() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [search, setSearch] = useState('');

  const clients = isDemo ? DEMO_CLIENTS : [];
  const audits = isDemo ? DEMO_AUDITS : [];

  const filtered = clients.filter(
    c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company_name.toLowerCase().includes(search.toLowerCase()) ||
      c.industry.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <TopBar
        title="Clients"
        subtitle={`${clients.length} total clients`}
        actions={
          <button
            onClick={() => navigate('/clients/new')}
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
              placeholder="Search clients by name or industry..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Add your first client to start running audits."
            action={
              <button
                onClick={() => navigate('/clients/new')}
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
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-primary transition-colors" />
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Globe className="w-3.5 h-3.5" />
                      <span className="truncate">{client.esp_platform}</span>
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
