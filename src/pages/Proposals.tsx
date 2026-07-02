import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSignature, LayoutTemplate, FileCheck2, Plus } from 'lucide-react';
import TopBar from '../components/layout/TopBar';
import ProposalList from '../components/proposal/ProposalList';
import ProposalTemplatesPanel from '../components/proposal/ProposalTemplatesPanel';
import ContractDocsPanel from '../components/proposal/ContractDocsPanel';
import { SkeletonTable } from '../components/ui/Skeleton';
import { listProposals } from '../lib/proposals-db';
import type { Proposal } from '../lib/types';

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileSignature },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'contracts', label: 'Contract Docs', icon: FileCheck2 },
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

  return (
    <div>
      <TopBar
        title="Proposals"
        subtitle={`${proposals.length} total proposals`}
        actions={
          <button
            onClick={openNewProposal}
            className="flex items-center gap-2 px-4 py-2 gradient-bg text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Proposal
          </button>
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
              <ProposalList
                proposals={proposals}
                onDeleted={id => setProposals(prev => prev.filter(p => p.id !== id))}
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
            )}
          </>
        )}
        {tab === 'templates' && <ProposalTemplatesPanel />}
        {tab === 'contracts' && <ContractDocsPanel />}
      </div>
    </div>
  );
}
