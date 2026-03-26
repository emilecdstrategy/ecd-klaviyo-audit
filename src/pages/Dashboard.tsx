import { useEffect, useLocation, useNavigate, useState } from 'react';
import {
  ClipboardCheck,
  Users,
  TrendingUp,
  FileText,
  Plus,
  UserPlus,
  Sparkles,
  ArrowRight,
  Clock,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import KPICard from '../components/ui/KPICard';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_CLIENTS, DEMO_AUDITS } from '../lib/demo-data';
import { formatCurrency } from '../lib/revenue-calculator';
import { listAudits, listClients } from '../lib/db';
import type { Audit, Client } from '../lib/types';

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isDemo } = useAuth();

  const [clients, setClients] = useState<Client[]>(isDemo ? DEMO_CLIENTS : []);
  const [audits, setAudits] = useState<Audit[]>(isDemo ? DEMO_AUDITS : []);

  useEffect(() => {
    let cancelled = false;
    if (isDemo) return;
    (async () => {
      try {
        const [c, a] = await Promise.all([listClients(), listAudits()]);
        if (cancelled) return;
        setClients(c.slice(0, 5));
        setAudits(a.slice(0, 5));
      } catch {
        // dashboard should still render even if lists fail
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const totalAudits = audits.length;
  const inProgress = audits.filter(a => a.status === 'in_progress').length;
  const completed = audits.filter(a => ['completed', 'published'].includes(a.status)).length;
  const totalRevOpp = audits.reduce((s, a) => s + a.total_revenue_opportunity, 0);

  return (
    <div>
      <TopBar title="Dashboard" subtitle="Welcome back" />

      <div className="p-8 space-y-8 animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={ClipboardCheck} label="Total Audits" value={totalAudits} accent="primary" />
          <KPICard icon={Clock} label="In Progress" value={inProgress} accent="warning" />
          <KPICard icon={FileText} label="Completed" value={completed} accent="success" />
          <KPICard icon={TrendingUp} label="Revenue Identified" value={formatCurrency(totalRevOpp)} accent="secondary" />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate('/audits/new', { state: { backgroundLocation: location } })}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            Start New Audit
          </button>
          <button
            onClick={() => navigate('/clients/new', { state: { backgroundLocation: location } })}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Client
          </button>
          {isDemo && (
            <button
              onClick={() => navigate('/audits/demo-audit-1')}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary/5 border border-brand-primary/20 text-sm font-medium text-brand-primary rounded-lg hover:bg-brand-primary/10 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Open Demo Audit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-xl card-shadow">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Recent Audits</h2>
                <button
                  onClick={() => navigate('/audits')}
                  className="text-xs text-brand-primary font-medium hover:underline flex items-center gap-1"
                >
                  View All <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {audits.slice(0, 5).map(audit => {
                  const client = clients.find(c => c.id === audit.client_id);
                  return (
                    <button
                      key={audit.id}
                      onClick={() => navigate(`/audits/${audit.id}`)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{audit.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{client?.company_name || 'Unknown'}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 ml-4">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(audit.total_revenue_opportunity)}
                        </span>
                        <StatusBadge status={audit.status} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl card-shadow">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Recent Clients</h2>
                <button
                  onClick={() => navigate('/clients')}
                  className="text-xs text-brand-primary font-medium hover:underline flex items-center gap-1"
                >
                  View All <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {clients.slice(0, 5).map(client => {
                  const clientAudits = audits.filter(a => a.client_id === client.id);
                  return (
                    <button
                      key={client.id}
                      onClick={() => navigate(`/clients/${client.id}`)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <Users className="w-4 h-4 text-gray-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{client.company_name}</p>
                          <p className="text-xs text-gray-500">{client.website_url || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <span className="text-xs text-gray-400">{clientAudits.length} audit{clientAudits.length !== 1 ? 's' : ''}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
