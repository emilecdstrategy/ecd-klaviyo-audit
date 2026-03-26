import { useState } from 'react';
import {
  Users,
  Settings,
  BookOpen,
  BarChart3,
  Key,
  Shield,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { DEMO_INDUSTRY_EXAMPLES } from '../lib/demo-data';
import { INDUSTRIES } from '../lib/constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'examples', label: 'Industry Examples', icon: BookOpen },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DEMO_USERS = [
  { id: '1', name: 'Emil G', email: 'emil@ecdigitalstrategy.com', role: 'admin' },
  { id: '2', name: 'Marcus Kim', email: 'marcus@ecdigitalstrategy.com', role: 'auditor' },
  { id: '3', name: 'Priya Patel', email: 'priya@ecdigitalstrategy.com', role: 'viewer' },
];

export default function AdminArea() {
  const [tab, setTab] = useState('users');
  const { hasRole } = useAuth();

  if (!hasRole('admin')) {
    return (
      <div>
        <TopBar title="Admin" />
        <div className="p-8 text-center">
          <Shield className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Access Restricted</h2>
          <p className="text-sm text-gray-500">You need admin permissions to access this area.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar title="Admin" subtitle="Manage users, templates, and settings" />

      <div className="p-8 animate-fade-in">
        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
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

        {tab === 'users' && <UsersTab />}
        {tab === 'examples' && <ExamplesTab />}
        {tab === 'benchmarks' && <BenchmarksTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function UsersTab() {
  return (
    <div className="bg-white rounded-xl card-shadow animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
        <button className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
          Invite User
        </button>
      </div>
      <div className="divide-y divide-gray-50">
        {DEMO_USERS.map(user => (
          <div key={user.id} className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold">
                {user.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={user.role === 'admin' ? 'published' : user.role === 'auditor' ? 'in_progress' : 'draft'} />
              <div className="min-w-[140px]">
                <Select defaultValue={user.role}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="auditor">Auditor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExamplesTab() {
  const [filterIndustry, setFilterIndustry] = useState('');
  const examples = DEMO_INDUSTRY_EXAMPLES.filter(
    e => !filterIndustry || e.industry === filterIndustry,
  );

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <div className="min-w-[220px]">
          <Select value={filterIndustry} onValueChange={v => setFilterIndustry(v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Industries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Industries</SelectItem>
              {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <button className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
          Add Example
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {examples.map(ex => (
          <div key={ex.id} className="bg-white rounded-xl card-shadow overflow-hidden group">
            <div className="aspect-video bg-gray-100 overflow-hidden">
              <img
                src={ex.image_url}
                alt={ex.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            <div className="p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{ex.title}</h3>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                  {ex.industry}
                </span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-brand-primary/10 rounded text-brand-primary">
                  {ex.email_type}
                </span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2">{ex.notes}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BenchmarksTab() {
  const benchmarks = [
    { flow: 'Abandoned Cart', low: '$150', high: '$300', unit: 'per 1K subs/mo' },
    { flow: 'Browse Abandonment', low: '$80', high: '$150', unit: 'per 1K subs/mo' },
    { flow: 'Welcome Series', low: '$100', high: '$200', unit: 'per 1K subs/mo' },
    { flow: 'Post-Purchase', low: '$60', high: '$120', unit: 'per 1K subs/mo' },
    { flow: 'Winback', low: '$40', high: '$80', unit: 'per 1K subs/mo' },
  ];

  return (
    <div className="bg-white rounded-xl card-shadow animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50">
        <h2 className="text-base font-semibold text-gray-900">Revenue Benchmarks</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          These benchmarks are used to calculate revenue opportunity estimates.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Flow Type</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Low Range</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">High Range</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Unit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {benchmarks.map(b => (
              <tr key={b.flow} className="hover:bg-gray-50/50">
                <td className="px-6 py-3 text-sm font-medium text-gray-900">{b.flow}</td>
                <td className="px-6 py-3 text-sm text-gray-700">{b.low}</td>
                <td className="px-6 py-3 text-sm text-gray-700">{b.high}</td>
                <td className="px-6 py-3 text-xs text-gray-400">{b.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="space-y-6 max-w-2xl animate-slide-up">
      <div className="bg-white rounded-xl p-6 card-shadow">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-gray-400" />
          <h3 className="text-base font-semibold text-gray-900">OpenAI Integration</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Configure your OpenAI API key to enable AI-powered audit analysis. This key is stored securely
          and used only for generating audit findings.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <input
            type="password"
            placeholder="sk-..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
          <p className="text-xs text-gray-400 mt-1">
            Stored as an environment variable in Supabase Edge Functions.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 card-shadow">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Audit Templates</h3>
        <p className="text-sm text-gray-500 mb-3">
          Manage audit section templates and default content. Templates define the structure of each audit report.
        </p>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">Template management coming in a future release.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 card-shadow">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Export Options</h3>
        <p className="text-sm text-gray-500 mb-3">
          Future integrations for exporting audit reports to external formats.
        </p>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          {/* Future: Google Slides export integration */}
          <p className="text-sm text-gray-400">Google Slides and PDF export coming soon.</p>
        </div>
      </div>
    </div>
  );
}
