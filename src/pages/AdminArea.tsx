import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Settings,
  Key,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { supabase } from '../lib/supabase';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type AdminUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: 'admin' | 'auditor' | 'viewer';
  created_at?: string | null;
};

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
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removingFor, setRemovingFor] = useState<string | null>(null);

  const currentUserId = currentUser?.id || '';

  const sorted = useMemo(() => {
    const copy = [...users];
    copy.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return copy;
  }, [users]);

  const reload = async () => {
    setError('');
    try {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error } = await supabase.functions.invoke('admin_users', {
        body: { action: 'list' },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to load users');
      setUsers((data.users ?? []) as AdminUserRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleBadgeStatus = (role: AdminUserRow['role']) =>
    role === 'admin' ? 'published' : role === 'auditor' ? 'in_progress' : 'draft';

  const onInvite = async () => {
    setError('');
    try {
      setInviting(true);
      const email = inviteEmail.trim();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error } = await supabase.functions.invoke('admin_users', {
        body: { action: 'invite', email },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Invite failed');
      setInviteEmail('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setInviting(false);
    }
  };

  const onChangeRole = async (userId: string, role: AdminUserRow['role']) => {
    setError('');
    const prev = users;
    setUsers(u => u.map(x => x.id === userId ? { ...x, role } : x));
    try {
      setSavingRoleFor(userId);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error } = await supabase.functions.invoke('admin_users', {
        body: { action: 'update_role', user_id: userId, role },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to save role');
    } catch (e) {
      setUsers(prev);
      setError(e instanceof Error ? e.message : 'Failed to save role');
    } finally {
      setSavingRoleFor(null);
    }
  };

  const onRemove = async (userId: string) => {
    setError('');
    if (userId === currentUserId) {
      setError("You can't remove your own account.");
      return;
    }
    if (!window.confirm('Remove this user? This cannot be undone.')) return;
    try {
      setRemovingFor(userId);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error } = await supabase.functions.invoke('admin_users', {
        body: { action: 'remove', user_id: userId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to remove user');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove user');
    } finally {
      setRemovingFor(null);
    }
  };

  return (
    <div className="bg-white rounded-xl card-shadow animate-slide-up">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@ecdigitalstrategy.com"
              className="w-[260px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <button
            onClick={onInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            {inviting ? 'Inviting...' : 'Invite User'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 pt-4">
          <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="px-6 py-6 text-sm text-gray-500">Loading users...</div>
      ) : (
      <div className="divide-y divide-gray-50">
        {sorted.map(user => (
          <div key={user.id} className="flex items-center justify-between px-6 py-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold">
                {(user.name || user.email || 'U')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(n => n[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{user.name || '—'}</p>
                <p className="text-xs text-gray-500">{user.email || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={roleBadgeStatus(user.role)} />
              <div className="min-w-[140px]">
                <Select value={user.role} onValueChange={v => onChangeRole(user.id, v as any)}>
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
              <button
                onClick={() => onRemove(user.id)}
                disabled={removingFor === user.id || user.id === currentUserId}
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={user.id === currentUserId ? "You can't remove yourself" : 'Remove user'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {savingRoleFor === user.id && (
                <span className="text-xs text-gray-400">Saving...</span>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [status, setStatus] = useState<{ configured: boolean; updated_at: string | null } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Your session expired. Please sign in again and retry.');
        const { data, error } = await supabase.functions.invoke('openai_key_admin', {
          body: { action: 'status' },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (error) throw error;
        if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to load OpenAI key status');
        setStatus({ configured: Boolean(data.configured), updated_at: data.updated_at ?? null });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load status');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    setError('');
    setSuccess('');
    try {
      setSaving(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Your session expired. Please sign in again and retry.');
      const { data, error } = await supabase.functions.invoke('openai_key_admin', {
        body: { action: 'set', openai_api_key: apiKey },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to save key');
      setApiKey('');
      setSuccess('Saved. Edge Functions will use this key for AI analysis.');
      // refresh status
      const st = await supabase.functions.invoke('openai_key_admin', { body: { action: 'status' }, headers: { Authorization: `Bearer ${token}` } });
      if (!st.error && st.data?.ok === true) {
        setStatus({ configured: Boolean(st.data.configured), updated_at: st.data.updated_at ?? null });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

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
        {status && (
          <div className="mb-4 text-xs text-gray-500">
            Status: {status.configured ? 'Configured' : 'Not configured'}
            {status.updated_at ? ` • Updated ${new Date(status.updated_at).toLocaleString()}` : ''}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
          <input
            type="password"
            placeholder="sk-..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            Stored encrypted in Supabase and used server-side only.
          </p>
        </div>
        {error && <div className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
        {success && <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{success}</div>}
        <div className="mt-4">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !apiKey.trim()}
            className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
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
