import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, LayoutTemplate, FileText, ArrowLeft, Plus } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import SiteFavicon from '../components/ui/SiteFavicon';
import { createClient, listClients } from '../lib/db';
import { listProposalTemplates } from '../lib/proposals-db';
import { createProposalFromTemplate } from '../lib/proposal-convert';
import type { Client, ProposalTemplate } from '../lib/types';

type NewProposalProps = { asModal?: boolean };

export default function NewProposal({ asModal }: NewProposalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillClientId = (location.state as { clientId?: string } | null)?.clientId;
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, t] = await Promise.all([
          listClients(),
          listProposalTemplates({ activeOnly: true }),
        ]);
        if (cancelled) return;
        setClients(c);
        setTemplates(t);
        if (prefillClientId) {
          const match = c.find(client => client.id === prefillClientId);
          if (match) setSelectedClient(match);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load clients');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prefillClientId]);

  const [creatingClient, setCreatingClient] = useState(false);
  const [createExpanded, setCreateExpanded] = useState(false);
  const [newWebsite, setNewWebsite] = useState('');

  const filteredClients = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter(
      c => c.company_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const trimmedSearch = search.trim();
  const hasExactMatch = clients.some(
    c => c.company_name.trim().toLowerCase() === trimmedSearch.toLowerCase(),
  );

  const createAndSelectClient = async () => {
    if (!trimmedSearch || creatingClient) return;
    setCreatingClient(true);
    setError('');
    try {
      const client = await createClient({
        name: '',
        company_name: trimmedSearch,
        email: '',
        website_url: newWebsite.trim(),
        industry: '',
        esp_platform: '',
        api_key_placeholder: '',
        notes: '',
      } as Omit<Client, 'id' | 'created_at'>);
      setClients(prev => [...prev, client]);
      setSelectedClient(client);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the client');
    } finally {
      setCreatingClient(false);
    }
  };

  const create = async (template: ProposalTemplate | null) => {
    if (!selectedClient || creating) return;
    setCreating(true);
    setError('');
    try {
      const proposal = await createProposalFromTemplate(selectedClient, template);
      navigate(`/proposals/${proposal.id}/edit`, { replace: !asModal });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create proposal');
      setCreating(false);
    }
  };

  const body = (
    <div className={asModal ? 'p-5' : 'p-8 max-w-2xl'}>
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>}

      {!selectedClient ? (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Who is this proposal for?</p>
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients, or type a new client name..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
            />
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">Loading clients…</p>
            ) : (
              <>
                {trimmedSearch && !hasExactMatch && !createExpanded && (
                  <button
                    type="button"
                    onClick={() => setCreateExpanded(true)}
                    className="flex w-full items-center gap-3 rounded-lg border border-dashed border-brand-primary/40 px-3 py-2.5 text-left hover:bg-brand-primary/[0.03]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">Create new client "{trimmedSearch}"</span>
                      <span className="block truncate text-xs text-gray-400">Adds a client you can complete later.</span>
                    </span>
                  </button>
                )}
                {trimmedSearch && !hasExactMatch && createExpanded && (
                  <div className="rounded-lg border border-brand-primary/40 p-3">
                    <p className="text-sm font-medium text-gray-900">New client: {trimmedSearch}</p>
                    <label className="mt-2 mb-1 block text-xs font-medium text-gray-600">Website (optional)</label>
                    <input
                      autoFocus
                      value={newWebsite}
                      onChange={e => setNewWebsite(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void createAndSelectClient();
                      }}
                      placeholder="https://example.com"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                    />
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setCreateExpanded(false)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void createAndSelectClient()}
                        disabled={creatingClient}
                        className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-60"
                      >
                        {creatingClient ? 'Creating…' : 'Create client'}
                      </button>
                    </div>
                  </div>
                )}
                {filteredClients.length === 0 && !trimmedSearch ? (
                  <p className="px-3 py-6 text-center text-sm text-gray-400">
                    No clients yet. Type a name above to create one.
                  </p>
                ) : (
                  filteredClients.map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClient(client)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-gray-200 hover:bg-gray-50"
                >
                  <SiteFavicon url={client.website_url} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{client.company_name}</span>
                    <span className="block truncate text-xs text-gray-400">{client.name}</span>
                  </span>
                </button>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setSelectedClient(null)}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium leading-none text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {selectedClient.company_name}
          </button>
          <p className="mb-3 text-sm font-medium text-gray-700">Start from</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {templates.map(template => (
              <button
                key={template.id}
                type="button"
                disabled={creating}
                onClick={() => create(template)}
                className="rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.03] disabled:opacity-50"
              >
                <LayoutTemplate className="mb-2 h-5 w-5 text-brand-primary" />
                <p className="text-sm font-semibold text-gray-900">{template.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {template.content_blocks.length} section{template.content_blocks.length === 1 ? '' : 's'}
                  {' · '}
                  {template.default_line_items.length} line item{template.default_line_items.length === 1 ? '' : 's'}
                </p>
              </button>
            ))}
            <button
              type="button"
              disabled={creating}
              onClick={() => create(null)}
              className="rounded-xl border border-dashed border-gray-300 p-4 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.03] disabled:opacity-50"
            >
              <FileText className="mb-2 h-5 w-5 text-gray-400" />
              <p className="text-sm font-semibold text-gray-900">Blank proposal</p>
              <p className="mt-0.5 text-xs text-gray-500">Start from scratch.</p>
            </button>
          </div>
          {creating && <p className="mt-4 text-center text-sm text-gray-400">Creating proposal…</p>}
        </div>
      )}
    </div>
  );

  if (asModal) return body;

  return (
    <div>
      <TopBar title="New Proposal" subtitle="Create a proposal for a client" />
      {body}
    </div>
  );
}
