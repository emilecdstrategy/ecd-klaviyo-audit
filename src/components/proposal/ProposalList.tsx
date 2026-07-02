import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSignature, Search, Filter, Trash2 } from 'lucide-react';
import StatusBadge from '../ui/StatusBadge';
import SiteFavicon from '../ui/SiteFavicon';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '../../contexts/AuthContext';
import { deleteProposal } from '../../lib/proposals-db';
import { deriveProposalStatus, PROPOSAL_STATUS_LABELS } from '../../lib/proposal-status';
import { computeProposalTotals, formatProposalTotal, proposalDiscountFromRow } from '../../lib/proposal-pricing';
import { formatCurrency } from '../../lib/revenue-calculator';
import type { Proposal, ProposalDisplayStatus } from '../../lib/types';

const FILTERABLE_STATUSES: ProposalDisplayStatus[] = ['draft', 'sent', 'viewed', 'won', 'lost', 'expired'];

function proposalValueSummary(proposal: Proposal): string {
  const items = proposal.line_items ?? [];
  if (items.length === 0) return '—';
  const totals = computeProposalTotals(items, proposalDiscountFromRow(proposal));
  const parts: string[] = [];
  if (totals.oneTimeTotal > 0 || totals.oneTimeHasLabelOnly) {
    parts.push(formatProposalTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly));
  }
  if (totals.monthlyTotal > 0) {
    parts.push(`${formatCurrency(totals.monthlyTotal)}/mo`);
  } else if (totals.monthlyHasLabelOnly) {
    parts.push('See items/mo');
  }
  return parts.length ? parts.join(' + ') : '—';
}

type ProposalListProps = {
  proposals: Proposal[];
  onDeleted: (id: string) => void;
  emptyAction?: React.ReactNode;
};

export default function ProposalList({ proposals, onDeleted, emptyAction }: ProposalListProps) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [deletingProposal, setDeletingProposal] = useState<Proposal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return proposals.filter(p => {
      const displayStatus = deriveProposalStatus(p);
      const matchSearch =
        p.title.toLowerCase().includes(q) ||
        (p.client?.company_name || '').toLowerCase().includes(q) ||
        `ecd-${String(p.proposal_number).padStart(4, '0')}`.includes(q);
      const matchStatus = statusFilter === '__all__' || displayStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [proposals, search, statusFilter]);

  return (
    <div>
      <Modal
        open={Boolean(deletingProposal)}
        title="Delete proposal?"
        onClose={() => {
          if (deleting) return;
          setDeletingProposal(null);
        }}
        className="max-w-lg"
      >
        <div className="p-5">
          <p className="text-sm text-gray-700">
            {deletingProposal
              ? `Delete “${deletingProposal.title || 'this proposal'}”? This action cannot be undone.`
              : ''}
          </p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setDeletingProposal(null)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting || !deletingProposal}
              onClick={async () => {
                if (!deletingProposal) return;
                try {
                  setDeleting(true);
                  await deleteProposal(deletingProposal.id);
                  onDeleted(deletingProposal.id);
                  setDeletingProposal(null);
                } catch (err: unknown) {
                  alert(err instanceof Error ? err.message : 'Failed to delete proposal');
                } finally {
                  setDeleting(false);
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting…' : 'Delete proposal'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search proposals..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
          <div className="min-w-[160px]">
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
              <SelectTrigger className="pl-9">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__"><SelectItemText>All</SelectItemText></SelectItem>
                {FILTERABLE_STATUSES.map(status => (
                  <SelectItem key={status} value={status}>
                    <SelectItemText>{PROPOSAL_STATUS_LABELS[status]}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={proposals.length === 0 ? 'No proposals yet' : 'No proposals found'}
          description={
            proposals.length === 0
              ? 'Create a proposal from an audit or start one from scratch.'
              : 'Try a different search or status filter.'
          }
          action={proposals.length === 0 ? emptyAction : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl card-shadow overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Proposal</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Client</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Value</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Updated</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(proposal => {
                const displayStatus = deriveProposalStatus(proposal);
                return (
                  <tr
                    key={proposal.id}
                    onClick={() => navigate(`/proposals/${proposal.id}`)}
                    className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {proposal.title || 'Untitled proposal'}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                        ECD-{String(proposal.proposal_number).padStart(4, '0')}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <SiteFavicon url={proposal.client?.website_url} />
                        <span className="text-sm text-gray-600 truncate">
                          {proposal.client?.company_name || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {proposalValueSummary(proposal)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={displayStatus} />
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-400">
                      {new Date(proposal.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {hasRole('admin') && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setDeletingProposal(proposal);
                            }}
                            className="p-1.5 rounded hover:bg-red-50 transition-colors"
                            title="Delete proposal"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-600" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
