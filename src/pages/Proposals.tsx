import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSignature, LayoutTemplate, FileCheck2, Plus, Settings2 } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import GlobalSearch from '../components/ui/GlobalSearch';
import ProposalList from '../components/proposal/ProposalList';
import ProposalKPIs from '../components/proposal/ProposalKPIs';
import ProposalTemplatesPanel from '../components/proposal/ProposalTemplatesPanel';
import ContractDocsPanel from '../components/proposal/ContractDocsPanel';
import ProposalSettingsPanel from '../components/proposal/ProposalSettingsPanel';
import ClientPickerModal from '../components/proposal/agent/ClientPickerModal';
import ProposalsWhatsNewModal from '../components/proposal/ProposalsWhatsNewModal';
import { SkeletonTable } from '../components/ui/Skeleton';
import { ProposalAgentProvider } from '../components/proposal/agent/ProposalAgentContext';
import { ProposalAgentLayout, AgentToggleButton } from '../components/proposal/agent/ProposalAgentLayout';
import { listProposals } from '../lib/proposals-db';
import { applyDraftAsNewProposal, ApplyCancelled, type ProposalDraftPayload } from '../lib/proposal-agent';
import { linkConversationToProposal } from '../lib/proposal-agent-db';
import type { Client, Proposal } from '../lib/types';

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileSignature },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'contracts', label: 'Contract Docs', icon: FileCheck2 },
  { id: 'settings', label: 'Settings', icon: Settings2 },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Proposals() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabId = TABS.some(t => t.id === tabParam) ? (tabParam as TabId) : 'overview';

  const openNewProposal = () =>
    navigate('/proposals/new', { state: { backgroundLocation: location } });

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const data = await listProposals();
        if (cancelled) return;
        setProposals(data);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load proposals');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // When the assistant proposes a draft with no client resolved, open a picker
  // and resolve/reject the Apply promise based on the user's choice.
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const pickerResolve = useRef<((client: Client) => void) | null>(null);
  const pickerReject = useRef<((err: Error) => void) | null>(null);

  const applyDraftForClient = async (
    draft: ProposalDraftPayload,
    conversationId: string,
    client: Client,
  ) => {
    const filledDraft: ProposalDraftPayload = {
      ...draft,
      recipient_name: draft.recipient_name || client.name || '',
      recipient_email: draft.recipient_email || client.email || '',
    };
    const proposal = await applyDraftAsNewProposal(filledDraft, client.id);
    if (conversationId) {
      await linkConversationToProposal(conversationId, proposal.id).catch(() => {});
    }
    navigate(`/proposals/${proposal.id}/edit`);
  };

  const onApplyDraft = async (draft: ProposalDraftPayload, conversationId: string) => {
    if (draft.client_id) {
      const proposal = await applyDraftAsNewProposal(draft, draft.client_id);
      if (conversationId) {
        await linkConversationToProposal(conversationId, proposal.id).catch(() => {});
      }
      navigate(`/proposals/${proposal.id}/edit`);
      return;
    }
    // No client resolved: let the user pick one.
    const client = await new Promise<Client>((resolve, reject) => {
      pickerResolve.current = resolve;
      pickerReject.current = reject;
      setClientPickerOpen(true);
    });
    await applyDraftForClient(draft, conversationId, client);
  };

  const closeClientPicker = () => {
    setClientPickerOpen(false);
    pickerReject.current?.(new ApplyCancelled());
    pickerResolve.current = null;
    pickerReject.current = null;
  };

  const selectClientForDraft = (client: Client) => {
    setClientPickerOpen(false);
    const resolve = pickerResolve.current;
    pickerResolve.current = null;
    pickerReject.current = null;
    resolve?.(client);
  };

  return (
    <ProposalAgentProvider config={{ proposalId: null, onApplyDraft }}>
    <ProposalsWhatsNewModal />
    <ClientPickerModal open={clientPickerOpen} onClose={closeClientPicker} onSelect={selectClientForDraft} />
    <ProposalAgentLayout>
    <div>
      <TopBar
        title="Proposals"
        subtitle={`${proposals.length} total proposals`}
        hideSearch
        actions={
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <button
              onClick={openNewProposal}
              className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              New Proposal
            </button>
            <AgentToggleButton className="px-4 py-2 text-sm" />
          </div>
        }
      />

      <div className="p-8 animate-fade-in">
        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSearchParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
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

        {tab === 'overview' && (
          <>
            {error && (
              <div className="mb-6 text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>
            )}
            {loading ? (
              <SkeletonTable rows={5} cols={6} />
            ) : (
              <>
              {proposals.length > 0 && <ProposalKPIs proposals={proposals} />}
              <ProposalList
                proposals={proposals}
                onDeleted={id => setProposals(prev => prev.filter(p => p.id !== id))}
                onUpdated={updated => setProposals(prev => prev.map(p => (p.id === updated.id ? updated : p)))}
                emptyAction={
                  <button
                    onClick={openNewProposal}
                    className="flex items-center gap-2 px-5 py-2.5 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Create First Proposal
                  </button>
                }
              />
              </>
            )}
          </>
        )}
        {tab === 'templates' && <ProposalTemplatesPanel />}
        {tab === 'contracts' && <ContractDocsPanel />}
        {tab === 'settings' && <ProposalSettingsPanel />}
      </div>
    </div>
    </ProposalAgentLayout>
    </ProposalAgentProvider>
  );
}
