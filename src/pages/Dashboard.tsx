import { useNavigate } from 'react-router-dom';
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
import { DEMO_CLIENTS, DEMO_AUDITS, DEMO_ACTIVITY } from '../lib/demo-data';
import { formatCurrency } from '../lib/revenue-calculator';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();

  const clients = isDemo ? DEMO_CLIENTS : [];
  const audits = isDemo ? DEMO_AUDITS : [];
  const activity = isDemo ? DEMO_ACTIVITY : [];

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
            onClick={() => navigate('/audits/new')}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            Start New Audit
          </button>
          <button
            onClick={() => navigate('/clients/new')}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
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
                {audits.map(audit => {
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
                {clients.map(client => {
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
                          <p className="text-xs text-gray-500">{client.industry}</p>
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

          <div className="space-y-6">
            <div className="bg-white rounded-xl card-shadow">
              <div className="px-5 py-4 border-b border-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
              </div>
              <div className="p-5 space-y-4">
                {activity.map(item => (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-brand-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{item.action}</span>
                        {' for '}
                        <span className="font-medium text-gray-900">{item.target}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {item.user} &middot; {item.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {isDemo && (
              <div className="bg-white rounded-xl card-shadow p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">How it works</p>
                <ol className="space-y-3">
                  {[
                    'Add a client and enter their details',
                    'Start a new audit and upload screenshots',
                    'Run AI analysis to generate findings',
                    'Review, edit, and publish the report',
                    'Share the report link with your client',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-brand-primary/10 text-brand-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-gray-600">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
