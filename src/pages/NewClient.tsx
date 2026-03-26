import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import { useAuth } from '../contexts/AuthContext';
import { createClient, ensureClientCreator } from '../lib/db';
import { supabase } from '../lib/supabase';

type NewClientProps = { asModal?: boolean };

export default function NewClient({ asModal }: NewClientProps) {
  const navigate = useNavigate();
  const { user, isDemo } = useAuth();
  const [form, setForm] = useState({
    name: '',
    company_name: '',
    website_url: '',
    notes: '',
    api_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (isDemo) {
      navigate('/clients');
      return;
    }
    try {
      setSaving(true);
      const payload = await ensureClientCreator(user, {
        name: form.name,
        company_name: form.company_name,
        website_url: form.website_url,
        industry: '',
        esp_platform: 'Klaviyo',
        api_key_placeholder: '',
        notes: form.notes,
      });
      const created = await createClient(payload as any);

      if (form.api_key.trim()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Your session expired. Please sign in again and retry.');
        const { data, error: fnErr } = await supabase.functions.invoke('klaviyo_connect_client', {
          body: { client_id: created.id, api_key: form.api_key.trim() },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (fnErr) throw fnErr;
        if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to connect Klaviyo');
      }

      navigate('/clients');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <div className={asModal ? 'p-5' : 'p-8 max-w-3xl'}>
      {!asModal && (
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Clients
        </button>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl p-6 card-shadow space-y-5">
          <h2 className="text-base font-semibold text-gray-900">Client Information</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => updateField('name', e.target.value)}
                  required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={form.company_name}
                  onChange={e => updateField('company_name', e.target.value)}
                  required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                  placeholder="Acme Co."
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Website URL</label>
              <input
                type="url"
                value={form.website_url}
                onChange={e => updateField('website_url', e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                placeholder="https://example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
                placeholder="Any relevant notes about this client..."
              />
            </div>
        </div>

        <div className="bg-white rounded-xl p-6 card-shadow">
          <h2 className="text-base font-semibold text-gray-900">API Connection</h2>
          <p className="text-sm text-gray-500 mt-1">
            Optional. Connect the Klaviyo Private API key now (stored encrypted) to skip this step during the audit.
          </p>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Klaviyo Private API Key</label>
            <input
              type="password"
              value={form.api_key}
              onChange={e => updateField('api_key', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              placeholder="pk_..."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {error && (
            <div className="mr-auto text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/clients')}
            className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Client'}
          </button>
        </div>
      </form>
    </div>
  );

  if (asModal) return body;

  return (
    <div>
      <TopBar title="Add Client" subtitle="Create a new client profile" />
      <div className="animate-fade-in">{body}</div>
    </div>
  );
}
