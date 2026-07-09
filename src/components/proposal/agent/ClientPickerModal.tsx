import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import Modal from '../../ui/Modal';
import SiteFavicon from '../../ui/SiteFavicon';
import { createClient, listClients } from '../../../lib/db';
import type { Client } from '../../../lib/types';

/**
 * Client picker used when the AI assistant proposes a draft with no client
 * attached. Same search + list pattern as the New Proposal flow.
 */
export default function ClientPickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (client: Client) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setError('');
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const c = await listClients();
        if (!cancelled) setClients(c);
      } catch {
        // Leave the list empty; the empty state explains it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      c => c.company_name.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q),
    );
  }, [clients, search]);

  const trimmed = search.trim();
  const exactMatch = clients.some(c => c.company_name.trim().toLowerCase() === trimmed.toLowerCase());

  const createAndSelect = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    setError('');
    try {
      const client = await createClient({
        name: '',
        company_name: trimmed,
        email: '',
        website_url: '',
        industry: '',
        esp_platform: '',
        api_key_placeholder: '',
        notes: '',
        created_by: '',
      } as Omit<Client, 'id' | 'created_at'>);
      onSelect(client);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the client');
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Which client is this proposal for?" className="max-w-lg">
      <div className="p-5">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients, or type a new client name..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">Loading clients…</p>
          ) : (
            <>
              {trimmed && !exactMatch && (
                <button
                  type="button"
                  disabled={creating}
                  onClick={createAndSelect}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed border-brand-primary/40 px-3 py-2.5 text-left hover:bg-brand-primary/[0.03] disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {creating ? 'Creating…' : `Create new client "${trimmed}"`}
                    </span>
                    <span className="block truncate text-xs text-gray-400">
                      Adds a client record you can complete later.
                    </span>
                  </span>
                </button>
              )}
              {filtered.length === 0 && !trimmed ? (
                <p className="px-3 py-6 text-center text-sm text-gray-400">
                  No clients yet. Type a name above to create one.
                </p>
              ) : (
                filtered.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => onSelect(client)}
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-gray-200 hover:bg-gray-50"
                  >
                    <SiteFavicon url={client.website_url} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">{client.company_name}</span>
                      {client.name && <span className="block truncate text-xs text-gray-400">{client.name}</span>}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
