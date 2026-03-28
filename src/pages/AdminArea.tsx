import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Settings,
  Key,
  Shield,
  Trash2,
  UserPlus,
  Image as ImageIcon,
  Plus,
  Code,
  Pencil,
  X,
} from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import AnnotationLayer from '../components/audit/AnnotationLayer';
import { useAuth } from '../contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../components/ui/select';
import { IndustrySelectWithCustom } from '../components/ui/IndustrySelect';
import { supabase } from '../lib/supabase';
import {
  listIndustryEmailLibrary,
  createIndustryEmail,
  updateIndustryEmail,
  deleteIndustryEmail,
  uploadAuditAssetFile,
  getPlatformSettings,
  updatePlatformSettings,
} from '../lib/db';
import type { IndustryEmailLibrary } from '../lib/types';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'email_library', label: 'Email Library', icon: ImageIcon },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** Flip to true to show the Audit Templates & Export Options placeholder cards in Settings again. */
const SHOW_ADMIN_SETTINGS_PLACEHOLDERS = false;

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
      <TopBar title="Admin" subtitle="Manage users and platform settings" />

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
        {tab === 'email_library' && <EmailLibraryTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removingFor, setRemovingFor] = useState<string | null>(null);
  const [removeConfirmUser, setRemoveConfirmUser] = useState<AdminUserRow | null>(null);

  const currentUserId = currentUser?.id || '';

  const sorted = useMemo(() => {
    const copy = [...users];
    copy.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return copy;
  }, [users]);

  const reload = async () => {
    setError('');
    try {
      setRefreshing(true);
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
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Show current user immediately to avoid a "blank loading" feel.
    if (currentUser?.id) {
      setUsers(prev => {
        if (prev.some(u => u.id === currentUser.id)) return prev;
        return [
          {
            id: currentUser.id,
            email: currentUser.email ?? null,
            name: currentUser.name ?? null,
            role: (currentUser.role as any) ?? 'viewer',
            created_at: null,
          },
          ...prev,
        ];
      });
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleBadgeStatus = (role: AdminUserRow['role']) =>
    role === 'admin' ? 'published' : role === 'auditor' ? 'in_review' : 'draft';

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

  const confirmRemove = async () => {
    if (!removeConfirmUser) return;
    const userId = removeConfirmUser.id;
    setError('');
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
      setRemoveConfirmUser(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove user');
    } finally {
      setRemovingFor(null);
    }
  };

  return (
    <div className="bg-white rounded-xl card-shadow animate-slide-up">
      <Modal
        open={!!removeConfirmUser}
        title="Remove user?"
        onClose={() => { if (!removingFor) setRemoveConfirmUser(null); }}
        className="max-w-lg"
      >
        <div className="p-5">
          <p className="text-sm text-gray-700">
            {removeConfirmUser
              ? <>Remove <span className="font-semibold">{removeConfirmUser.name || removeConfirmUser.email}</span>? They will lose access to the platform. This cannot be undone.</>
              : 'Remove this user? This cannot be undone.'}
          </p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={!!removingFor}
              onClick={() => setRemoveConfirmUser(null)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!!removingFor}
              onClick={confirmRemove}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {removingFor ? 'Removing…' : 'Remove user'}
            </button>
          </div>
        </div>
      </Modal>

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

      <div className="divide-y divide-gray-50">
        {refreshing && (
          <div className="px-6 py-3 text-xs text-gray-400">Refreshing users…</div>
        )}
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
                    <SelectItem value="admin"><SelectItemText>Admin</SelectItemText></SelectItem>
                    <SelectItem value="auditor"><SelectItemText>Auditor</SelectItemText></SelectItem>
                    <SelectItem value="viewer"><SelectItemText>Viewer</SelectItemText></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <button
                onClick={() => {
                  if (user.id === currentUserId) {
                    setError("You can't remove your own account.");
                    return;
                  }
                  setRemoveConfirmUser(user);
                }}
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
    </div>
  );
}

function EmailLibraryTab() {
  const [entries, setEntries] = useState<IndustryEmailLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingEntry, setEditingEntry] = useState<IndustryEmailLibrary | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [formIndustry, setFormIndustry] = useState('');
  const [formName, setFormName] = useState('');
  const [formContentType, setFormContentType] = useState<'image' | 'html'>('image');
  const [formHtml, setFormHtml] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formAnnotations, setFormAnnotations] = useState<Array<{ x: number; y: number; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [globalAnnotationSize, setGlobalAnnotationSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [globalAnnotationsExpanded, setGlobalAnnotationsExpanded] = useState(false);
  const [globalSettingsLoaded, setGlobalSettingsLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const [data, settings] = await Promise.all([listIndustryEmailLibrary(), getPlatformSettings()]);
      setEntries(data);
      setGlobalAnnotationSize(settings.annotation_size);
      setGlobalAnnotationsExpanded(settings.annotations_expanded);
      setGlobalSettingsLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const saveGlobalAnnotationSize = async (v: 'sm' | 'md' | 'lg') => {
    setGlobalAnnotationSize(v);
    try { await updatePlatformSettings({ annotation_size: v }); } catch { /* ignore */ }
  };

  const saveGlobalAnnotationsExpanded = async (v: boolean) => {
    setGlobalAnnotationsExpanded(v);
    try { await updatePlatformSettings({ annotations_expanded: v }); } catch { /* ignore */ }
  };

  const resetForm = () => {
    setFormIndustry('');
    setFormName('');
    setFormContentType('html');
    setFormHtml('');
    setFormImageUrl('');
    setFormAnnotations([]);
    setEditingEntry(null);
    setShowForm(false);
  };

  const openEditForm = (entry: IndustryEmailLibrary) => {
    setEditingEntry(entry);
    setFormIndustry(entry.industry);
    setFormName(entry.name);
    setFormContentType(entry.content_type);
    setFormHtml(entry.html_content || '');
    setFormImageUrl(entry.image_url || '');
    setFormAnnotations(entry.default_annotations || []);
    setShowForm(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `email-library/${crypto.randomUUID()}_${safeName}`;
      const { error } = await supabase.storage.from('audit-assets').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('audit-assets').getPublicUrl(path);
      setFormImageUrl(data.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setError('');
    if (!formIndustry.trim()) { setError('Industry is required'); return; }
    if (formContentType === 'image' && !formImageUrl.trim()) { setError('Please upload an image'); return; }
    if (formContentType === 'html' && !formHtml.trim()) { setError('Please paste the HTML'); return; }
    try {
      setSaving(true);
      const payload = {
        industry: formIndustry.trim(),
        name: formName.trim() || formIndustry.trim(),
        content_type: formContentType,
        html_content: formContentType === 'html' ? formHtml : null,
        image_url: formContentType === 'image' ? formImageUrl : null,
        default_annotations: formAnnotations,
      };
      if (editingEntry) {
        await updateIndustryEmail(editingEntry.id, payload);
      } else {
        await createIndustryEmail(payload as any);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteIndustryEmail(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const fakeAnnotations = formAnnotations.map((a, i) => ({
    id: `temp-${i}`,
    audit_section_id: '',
    asset_id: '',
    x_position: a.x,
    y_position: a.y,
    label: a.label,
    side: 'optimized' as const,
    created_at: '',
  }));

  const handleAddAnnotation = (_x: number, _y: number, label: string) => {
    setFormAnnotations(prev => [...prev, { x: _x, y: _y, label }]);
  };

  const handleRemoveAnnotation = (id: string) => {
    const idx = parseInt(id.replace('temp-', ''), 10);
    setFormAnnotations(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Industry Email Library</h2>
          <p className="text-sm text-gray-500 mt-0.5">Upload ECD benchmark emails for each industry. These are shown on audit reports next to the client's actual email.</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add Example
          </button>
        )}
      </div>

      {globalSettingsLoaded && (
        <div className="bg-white rounded-xl px-5 py-4 card-shadow flex items-center gap-6">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Annotation Settings</span>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600 shrink-0">Size</label>
            <Select value={globalAnnotationSize} onValueChange={v => saveGlobalAnnotationSize(v as 'sm' | 'md' | 'lg')}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sm"><SelectItemText>Small</SelectItemText></SelectItem>
                <SelectItem value="md"><SelectItemText>Medium</SelectItemText></SelectItem>
                <SelectItem value="lg"><SelectItemText>Large</SelectItemText></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={globalAnnotationsExpanded}
              onClick={() => saveGlobalAnnotationsExpanded(!globalAnnotationsExpanded)}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${globalAnnotationsExpanded ? 'bg-brand-primary' : 'bg-gray-200'}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${globalAnnotationsExpanded ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs font-medium text-gray-600">Always show labels</span>
          </label>
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>}

      {showForm && (
        <div className="bg-white rounded-xl p-6 card-shadow space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{editingEntry ? 'Edit Example' : 'New Industry Example'}</h3>
            <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <IndustrySelectWithCustom value={formIndustry} onValueChange={setFormIndustry} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Welcome Series Best Practice"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormContentType('html')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${formContentType === 'html' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                <Code className="w-4 h-4" /> HTML Paste
              </button>
              <button
                type="button"
                onClick={() => setFormContentType('image')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${formContentType === 'image' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                <ImageIcon className="w-4 h-4" /> Image Upload
              </button>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-500 leading-relaxed">
            {formContentType === 'html' ? (
              <>
                <p className="font-medium text-gray-700 mb-1">How to get the email HTML:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Install the <a href="https://chromewebstore.google.com/detail/save-email-template-by-se/abokklkondgpdlcajcjiobegghjfccih" target="_blank" rel="noreferrer" className="text-brand-primary underline">Save Email Template</a> Chrome extension</li>
                  <li>Send a test email to yourself and open it in Gmail</li>
                  <li>In Gmail, click the three dots (<strong>⋮</strong>) and select <strong>Show original</strong></li>
                  <li>Click the extension icon, then <strong>Capture from Gmail</strong>, then <strong>Download HTML</strong></li>
                  <li>Open the downloaded HTML file in a text editor, select all the code, and paste it below</li>
                </ol>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-700 mb-1">How to get the email screenshot:</p>
                <ol className="list-decimal ml-4 space-y-0.5">
                  <li>Install the <a href="https://chromewebstore.google.com/detail/save-email-template-by-se/abokklkondgpdlcajcjiobegghjfccih" target="_blank" rel="noreferrer" className="text-brand-primary underline">Save Email Template</a> Chrome extension</li>
                  <li>Send a test email to yourself and open it in Gmail</li>
                  <li>In Gmail, click the three dots (<strong>⋮</strong>) and select <strong>Show original</strong></li>
                  <li>Click the extension icon, then <strong>Capture from Gmail</strong>, then <strong>Download Image</strong></li>
                  <li>Upload the downloaded image below</li>
                </ol>
              </>
            )}
          </div>

          {formContentType === 'image' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Screenshot</label>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              {formImageUrl ? (
                <div className="space-y-2">
                  <img src={formImageUrl} alt="Preview" className="max-h-64 rounded-lg border border-gray-100" />
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs text-brand-primary font-medium hover:underline">
                    {uploading ? 'Uploading...' : 'Replace image'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-8 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 hover:border-brand-primary hover:text-brand-primary transition-colors"
                >
                  {uploading ? 'Uploading...' : 'Click to upload image'}
                </button>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email HTML</label>
              <textarea
                value={formHtml}
                onChange={e => setFormHtml(e.target.value)}
                rows={8}
                placeholder="Paste the full email HTML here..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-y"
              />
            </div>
          )}

          {((formContentType === 'image' && formImageUrl) || (formContentType === 'html' && formHtml)) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Annotations ({formAnnotations.length}) — click on the preview to place pins
              </label>

              <div className="max-w-md mx-auto">
                <AnnotationLayer
                  imageUrl={formContentType === 'image' ? formImageUrl : undefined}
                  htmlContent={formContentType === 'html' ? formHtml : undefined}
                  annotations={fakeAnnotations}
                  onAddAnnotation={handleAddAnnotation}
                  onRemoveAnnotation={handleRemoveAnnotation}
                  editable
                  side="optimized"
                  markerSize={globalAnnotationSize}
                  alwaysShowLabels={globalAnnotationsExpanded}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingEntry ? 'Update' : 'Save'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl p-8 card-shadow text-center text-sm text-gray-400">Loading...</div>
      ) : entries.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl p-8 card-shadow text-center">
          <ImageIcon className="w-10 h-10 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No benchmark emails yet. Add your first industry example above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map(entry => (
            <div key={entry.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden card-shadow group">
              <div
                className="h-48 bg-gray-50 overflow-y-auto relative cursor-pointer hover:ring-2 hover:ring-brand-primary/30 transition-shadow"
                onClick={() => openEditForm(entry)}
              >
                {entry.content_type === 'image' && entry.image_url ? (
                  <img src={entry.image_url} alt={entry.name} className="w-full object-cover object-top" />
                ) : entry.content_type === 'html' && entry.html_content ? (
                  <iframe srcDoc={entry.html_content} sandbox="allow-same-origin" className="w-full border-0 pointer-events-none" scrolling="no" style={{ height: 1200, overflow: 'hidden' }} title={entry.name} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-300">No preview</div>
                )}
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{entry.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{entry.industry} · {entry.content_type === 'html' ? 'HTML' : 'Image'} · {entry.default_annotations?.length || 0} annotations</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => openEditForm(entry)} className="text-xs text-brand-primary font-medium hover:underline inline-flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
                  <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-500 font-medium hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
                </div>
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
  const [statusLoading, setStatusLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatusLoading(true);
        // Supabase client attaches the session JWT automatically — skip extra getSession() round trip.
        const { data, error } = await supabase.functions.invoke('openai_key_admin', {
          body: { action: 'status' },
        });
        if (cancelled) return;
        if (error) throw error;
        if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to load OpenAI key status');
        setStatus({ configured: Boolean(data.configured), updated_at: data.updated_at ?? null });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load status');
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    setError('');
    setSuccess('');
    try {
      setSaving(true);
      const { data, error } = await supabase.functions.invoke('openai_key_admin', {
        body: { action: 'set', openai_api_key: apiKey },
      });
      if (error) throw error;
      if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to save key');
      setApiKey('');
      setEditing(false);
      setSuccess('Saved. Edge Functions will use this key for AI analysis.');
      const st = await supabase.functions.invoke('openai_key_admin', { body: { action: 'status' } });
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
        {statusLoading ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-4" aria-busy="true">
            <div className="h-4 bg-gray-200/80 rounded w-[40%] mb-2.5 animate-pulse" />
            <div className="h-3 bg-gray-100 rounded w-[65%] animate-pulse" />
          </div>
        ) : status?.configured && !editing ? (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-800">API key is configured</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  {status.updated_at ? `Last updated ${new Date(status.updated_at).toLocaleString()}` : 'Stored encrypted and used server-side only.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditing(true); setSuccess(''); setError(''); }}
                className="px-3 py-1.5 text-sm font-medium text-brand-primary border border-brand-primary/30 rounded-lg hover:bg-brand-primary/5 transition-colors"
              >
                Edit Key
              </button>
            </div>
            {error && <div className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
            {success && <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{success}</div>}
          </>
        ) : (
          <>
            {status && !status.configured && (
              <div className="mb-4 text-xs text-gray-500">Status: Not configured</div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {status?.configured ? 'New API Key' : 'API Key'}
              </label>
              <input
                type="password"
                placeholder="sk-..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoFocus={editing}
              />
              <p className="text-xs text-gray-400 mt-1">
                Stored encrypted in Supabase and used server-side only.
              </p>
            </div>
            {error && <div className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
            {success && <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{success}</div>}
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={saving || !apiKey.trim()}
                className="px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => { setEditing(false); setApiKey(''); setError(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {SHOW_ADMIN_SETTINGS_PLACEHOLDERS && (
        <>
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
        </>
      )}
    </div>
  );
}
