import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import { updateClient } from '../../lib/db';
import type { Client } from '../../lib/types';

/** Lightweight editor for a client's core details, usable from anywhere. */
export default function ClientEditModal({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: Client;
  onClose: () => void;
  onSaved: (client: Client) => void;
}) {
  const [companyName, setCompanyName] = useState(client.company_name);
  const [name, setName] = useState(client.name ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(client.website_url ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset the form whenever a different client / fresh open occurs.
  useEffect(() => {
    if (!open) return;
    setCompanyName(client.company_name);
    setName(client.name ?? '');
    setEmail(client.email ?? '');
    setWebsiteUrl(client.website_url ?? '');
    setError('');
  }, [open, client]);

  const save = async () => {
    if (!companyName.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateClient(client.id, {
        company_name: companyName.trim(),
        name: name.trim(),
        email: email.trim(),
        website_url: websiteUrl.trim(),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the client');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20';
  const label = 'mb-1 block text-xs font-medium text-gray-600';

  return (
    <Modal open={open} onClose={onClose} title="Edit client" className="max-w-lg">
      <div className="space-y-4 p-5">
        <div>
          <label className={label}>Company name</label>
          <input className={field} value={companyName} onChange={e => setCompanyName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className={label}>Contact name</label>
          <input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Who signs and receives the proposal" />
        </div>
        <div>
          <label className={label}>Contact email</label>
          <input className={field} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" />
        </div>
        <div>
          <label className={label}>Website</label>
          <input className={field} value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !companyName.trim()}
            className="rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
