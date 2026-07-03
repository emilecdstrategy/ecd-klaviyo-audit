import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FileSignature,
  Search,
  Filter,
  Trash2,
  MoreVertical,
  Send,
  Link2,
  Printer,
  Trophy,
  XCircle,
} from 'lucide-react';
import StatusBadge from '../ui/StatusBadge';
import SiteFavicon from '../ui/SiteFavicon';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '../../contexts/AuthContext';
import SendProposalModal from './SendProposalModal';
import {
  deleteProposal,
  getProposal,
  markProposalLost,
  markProposalSent,
  markProposalWon,
} from '../../lib/proposals-db';
import { deriveProposalStatus, PROPOSAL_STATUS_LABELS } from '../../lib/proposal-status';
import { computeProposalTotals, formatProposalTotal, proposalDiscountFromRow } from '../../lib/proposal-pricing';
import { formatCurrency } from '../../lib/revenue-calculator';
import { publicProposalOrigin } from '../../lib/public-origin';
import type { Proposal, ProposalDisplayStatus } from '../../lib/types';

const FILTERABLE_STATUSES: ProposalDisplayStatus[] = ['draft', 'sent', 'viewed', 'won', 'lost', 'expired'];

function isClosedProposal(proposal: Proposal): boolean {
  return proposal.status === 'won' || proposal.status === 'lost';
}

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
  onUpdated?: (proposal: Proposal) => void;
  emptyAction?: React.ReactNode;
};

export default function ProposalList({ proposals, onDeleted, onUpdated, emptyAction }: ProposalListProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [deletingProposal, setDeletingProposal] = useState<Proposal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ proposal: Proposal; buttonTop: number; buttonBottom: number; right: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sendProposal, setSendProposal] = useState<Proposal | null>(null);
  const [draftLinkProposal, setDraftLinkProposal] = useState<Proposal | null>(null);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ proposal: Proposal; action: 'won' | 'lost' } | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

  const patch = (updated: Proposal) => onUpdated?.(updated);

  useEffect(() => {
    if (!menuAnchor) return;
    const close = () => setMenuAnchor(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuAnchor]);

  useLayoutEffect(() => {
    if (!menuAnchor) {
      setMenuPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - menuAnchor.buttonBottom - 8;
    const spaceAbove = menuAnchor.buttonTop - 8;
    if (height > spaceBelow && spaceAbove > spaceBelow) {
      setMenuPos({ bottom: window.innerHeight - menuAnchor.buttonTop + 4, right: menuAnchor.right });
    } else {
      setMenuPos({ top: menuAnchor.buttonBottom + 4, right: menuAnchor.right });
    }
  }, [menuAnchor]);

  const copyLink = async (proposal: Proposal) => {
    setLinkBusyId(proposal.id);
    try {
      const updated = proposal.public_token ? proposal : await markProposalSent(proposal);
      const url = `${publicProposalOrigin()}/proposal/${updated.public_token}`;
      await navigator.clipboard.writeText(url);
      toast(proposal.public_token ? 'Link copied.' : 'Link copied. The proposal is now live.');
      if (!proposal.public_token) patch(updated);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to copy link');
    } finally {
      setLinkBusyId(null);
      setDraftLinkProposal(null);
    }
  };

  const runAction = async () => {
    if (!actionTarget) return;
    setActing(true);
    setActionError('');
    try {
      const updated =
        actionTarget.action === 'won'
          ? await markProposalWon(actionTarget.proposal.id)
          : await markProposalLost(actionTarget.proposal.id, lostReason.trim() || null);
      patch(updated);
      setActionTarget(null);
      setLostReason('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update proposal');
    } finally {
      setActing(false);
    }
  };

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

      {sendProposal && (
        <SendProposalModal
          open={Boolean(sendProposal)}
          proposal={sendProposal}
          client={sendProposal.client}
          onClose={() => setSendProposal(null)}
          onSent={async emailStatus => {
            toast(
              emailStatus === 'sent'
                ? 'Proposal emailed to the client'
                : 'Proposal is live. Email sending isn’t configured yet, so copy the link and send it yourself.',
            );
            try {
              const updated = await getProposal(sendProposal.id);
              if (updated) patch(updated);
            } catch {
              // best effort refresh
            }
          }}
        />
      )}

      <Modal
        open={Boolean(draftLinkProposal)}
        title="Share this draft?"
        onClose={() => (linkBusyId ? undefined : setDraftLinkProposal(null))}
        className="max-w-lg"
      >
        <div className="p-5">
          <p className="text-sm text-gray-700">
            Copying the link makes this proposal live: it gets a public URL, the contract text is locked in,
            the validity window starts, and the status changes to <strong>Sent</strong>.
          </p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={Boolean(linkBusyId)}
              onClick={() => setDraftLinkProposal(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={Boolean(linkBusyId)}
              onClick={() => draftLinkProposal && copyLink(draftLinkProposal)}
              className="rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {linkBusyId ? 'Working…' : 'Go live & copy link'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(actionTarget)}
        title={actionTarget?.action === 'won' ? 'Mark proposal as won?' : 'Mark proposal as lost?'}
        onClose={() => {
          if (acting) return;
          setActionTarget(null);
          setActionError('');
        }}
        className="max-w-lg"
      >
        <div className="p-5">
          {actionTarget?.action === 'won' && (
            <p className="text-sm text-gray-700">
              {actionTarget.proposal.client_signed_at
                ? 'Mark this signed proposal as won.'
                : 'This marks the proposal won without a client signature.'}
            </p>
          )}
          {actionTarget?.action === 'lost' && (
            <div>
              <p className="text-sm text-gray-700">Optionally note why this proposal was lost:</p>
              <input
                type="text"
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                placeholder="e.g. Went with another agency, budget cut…"
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          )}
          {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={acting}
              onClick={() => { setActionTarget(null); setActionError(''); }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={runAction}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                actionTarget?.action === 'lost' ? 'bg-red-600 hover:bg-red-700' : 'gradient-bg hover:opacity-90'
              }`}
            >
              {acting ? 'Working…' : actionTarget?.action === 'won' ? 'Mark won' : 'Mark lost'}
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
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            if (menuAnchor?.proposal.id === proposal.id) {
                              setMenuAnchor(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const anchor = {
                                proposal,
                                buttonTop: rect.top,
                                buttonBottom: rect.bottom,
                                right: window.innerWidth - rect.right,
                              };
                              setMenuAnchor(anchor);
                              setMenuPos({ top: anchor.buttonBottom + 4, right: anchor.right });
                            }
                          }}
                          className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                          title="More actions"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {menuAnchor && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuAnchor(null)} />
          <div
            ref={menuRef}
            style={{ top: menuPos?.top, bottom: menuPos?.bottom, right: menuPos?.right ?? menuAnchor.right }}
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {!isClosedProposal(menuAnchor.proposal) && (
              <button
                type="button"
                onClick={() => { const p = menuAnchor.proposal; setMenuAnchor(null); setSendProposal(p); }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <Send className="h-3.5 w-3.5 text-gray-400" />
                {menuAnchor.proposal.status === 'draft' ? 'Send to client' : 'Resend'}
              </button>
            )}
            <button
              type="button"
              disabled={linkBusyId === menuAnchor.proposal.id}
              onClick={() => {
                const p = menuAnchor.proposal;
                setMenuAnchor(null);
                if (!p.public_token && p.status === 'draft') {
                  setDraftLinkProposal(p);
                } else {
                  copyLink(p);
                }
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5 text-gray-400" />
              Copy client link
            </button>
            <button
              type="button"
              onClick={() => {
                const p = menuAnchor.proposal;
                setMenuAnchor(null);
                navigate(`/proposals/${p.id}?print=1`);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Printer className="h-3.5 w-3.5 text-gray-400" />
              Download PDF
            </button>
            {!isClosedProposal(menuAnchor.proposal) && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  onClick={() => { const p = menuAnchor.proposal; setMenuAnchor(null); setActionTarget({ proposal: p, action: 'won' }); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50"
                >
                  <Trophy className="h-3.5 w-3.5" />
                  Mark won
                </button>
                <button
                  type="button"
                  onClick={() => { const p = menuAnchor.proposal; setMenuAnchor(null); setActionTarget({ proposal: p, action: 'lost' }); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Mark lost
                </button>
              </>
            )}
            {hasRole('admin') && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  onClick={() => { const p = menuAnchor.proposal; setMenuAnchor(null); setDeletingProposal(p); }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove proposal
                </button>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
