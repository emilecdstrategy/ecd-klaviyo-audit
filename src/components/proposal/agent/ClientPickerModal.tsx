import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Modal from '../../ui/Modal';
import SiteFavicon from '../../ui/SiteFavicon';
import { listClients } from '../../../lib/db';
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

  useEffect(() => {
    if (!open) return;
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
            placeholder="Search clients..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">Loading clients…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              {clients.length === 0 ? 'No clients yet. Add a client first.' : 'No clients match your search.'}
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
        </div>
      </div>
    </Modal>
  );
}
