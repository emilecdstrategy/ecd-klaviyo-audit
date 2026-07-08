import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye } from 'lucide-react';
import AppPreloader from '../components/ui/AppPreloader';
import ProposalDocument from '../components/proposal/ProposalDocument';
import { ProposalEditProvider, useProposalEdit } from '../components/proposal/edit/ProposalEditContext';
import { ProposalAgentProvider } from '../components/proposal/agent/ProposalAgentContext';
import { ProposalAgentLayout, AgentToggleButton } from '../components/proposal/agent/ProposalAgentLayout';
import { useProposalData } from '../hooks/useProposalData';
import { applyEditSet, buildSnapshot, type ProposalEditSet } from '../lib/proposal-agent';

function SaveStatusDot() {
  const { saveStatus } = useProposalEdit();
  const label =
    saveStatus === 'saving' ? 'Saving…' :
    saveStatus === 'saved' ? 'Saved' :
    saveStatus === 'error' ? 'Save failed' : '';
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          saveStatus === 'error' ? 'bg-red-500' : saveStatus === 'saving' ? 'bg-amber-400' : 'bg-emerald-500'
        }`}
      />
      {label}
    </span>
  );
}

export default function ProposalEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, setData, loading, loadError } = useProposalData(id);

  // Signed proposals are immutable — bounce to the detail view.
  useEffect(() => {
    if (data?.proposal.client_signed_at) {
      navigate(`/proposals/${data.proposal.id}`, { replace: true });
    }
  }, [data?.proposal.client_signed_at, data?.proposal.id, navigate]);

  const blockTitles = useMemo(
    () => new Map((data?.proposal.content_blocks ?? []).map(b => [b.key, b.title])),
    [data?.proposal.content_blocks],
  );
  const itemNames = useMemo(
    () => new Map((data?.lineItems ?? []).map(li => [li.id, li.name])),
    [data?.lineItems],
  );

  if (loading) return <AppPreloader />;

  if (loadError || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-gray-500">{loadError || 'Proposal not found'}</p>
        <Link to="/proposals" className="text-sm font-medium text-brand-primary hover:underline">
          Back to proposals
        </Link>
      </div>
    );
  }

  const { proposal, client, lineItems, contractDocs, signatures, settings } = data;

  const onApplyEdits = async (edits: ProposalEditSet) => {
    const result = await applyEditSet(proposal, lineItems, edits);
    setData(prev =>
      prev ? { ...prev, proposal: result.proposal, lineItems: result.lineItems } : prev,
    );
  };

  return (
    <ProposalAgentProvider
      config={{
        proposalId: proposal.id,
        clientId: proposal.client_id,
        getSnapshot: () => buildSnapshot(proposal, lineItems),
        onApplyEdits,
      }}
    >
      <ProposalAgentLayout blockTitles={blockTitles} itemNames={itemNames}>
        <ProposalEditProvider
          mode="edit"
          proposal={proposal}
          lineItems={lineItems}
          onProposalChange={next => setData(prev => (prev ? { ...prev, proposal: next } : prev))}
          onLineItemsChange={next => setData(prev => (prev ? { ...prev, lineItems: next } : prev))}
        >
          <div className="min-h-screen bg-brand-surface">
            <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/90 backdrop-blur print:hidden">
              <div className="mx-auto flex h-14 max-w-[960px] items-center gap-4 px-4">
                <Link
                  to={`/proposals/${proposal.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium leading-none text-gray-500 hover:text-gray-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {client.company_name}
                    <span className="ml-2 font-normal text-gray-400">Editing proposal</span>
                  </p>
                </div>
                <SaveStatusDot />
                <AgentToggleButton />
                <Link
                  to={`/proposals/${proposal.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Link>
              </div>
            </header>

            <main className="mx-auto max-w-[880px] px-4 py-8 sm:px-6">
              <ProposalDocument
                proposal={proposal}
                client={client}
                lineItems={lineItems}
                contractDocs={contractDocs}
                signatures={signatures}
                settings={settings}
              />
            </main>
          </div>
        </ProposalEditProvider>
      </ProposalAgentLayout>
    </ProposalAgentProvider>
  );
}
