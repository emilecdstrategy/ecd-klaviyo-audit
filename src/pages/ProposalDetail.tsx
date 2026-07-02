import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trophy, XCircle, RotateCcw, Clock } from 'lucide-react';
import AppPreloader from '../components/ui/AppPreloader';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import ProposalDocument from '../components/proposal/ProposalDocument';
import ProposalActivityTimeline from '../components/proposal/ProposalActivityTimeline';
import { ProposalEditProvider } from '../components/proposal/edit/ProposalEditContext';
import { useProposalData } from '../hooks/useProposalData';
import { markProposalLost, markProposalWon, reopenProposal } from '../lib/proposals-db';
import { deriveProposalStatus } from '../lib/proposal-status';

export default function ProposalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, loadError, reload } = useProposalData(id);
  const [confirmAction, setConfirmAction] = useState<'won' | 'lost' | 'reopen' | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

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

  const { proposal, client, lineItems, contractDocs, signatures, events, settings } = data;
  const displayStatus = deriveProposalStatus(proposal);
  const isSigned = Boolean(proposal.client_signed_at);
  const isClosed = proposal.status === 'won' || proposal.status === 'lost';

  const runAction = async () => {
    if (!confirmAction) return;
    setActing(true);
    setActionError('');
    try {
      if (confirmAction === 'won') await markProposalWon(proposal.id);
      else if (confirmAction === 'lost') await markProposalLost(proposal.id, lostReason.trim() || null);
      else await reopenProposal(proposal.id);
      setConfirmAction(null);
      setLostReason('');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4">
          <Link
            to="/proposals"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Proposals
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">
              {client.company_name}
              <span className="ml-2 font-normal text-gray-400">
                ECD-{String(proposal.proposal_number).padStart(4, '0')}
              </span>
            </p>
          </div>
          <StatusBadge status={displayStatus} size="md" />
        </div>
      </header>

      <Modal
        open={Boolean(confirmAction)}
        title={
          confirmAction === 'won' ? 'Mark proposal as won?' :
          confirmAction === 'lost' ? 'Mark proposal as lost?' : 'Reopen proposal?'
        }
        onClose={() => (acting ? undefined : setConfirmAction(null))}
        className="max-w-lg"
      >
        <div className="p-5">
          {confirmAction === 'won' && !isSigned && (
            <p className="text-sm text-gray-700">
              This marks the proposal won without a client signature. The signature section will remain empty.
            </p>
          )}
          {confirmAction === 'won' && isSigned && (
            <p className="text-sm text-gray-700">Mark this signed proposal as won.</p>
          )}
          {confirmAction === 'lost' && (
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
          {confirmAction === 'reopen' && (
            <p className="text-sm text-gray-700">Move this proposal back to “sent” so it can be won or lost again.</p>
          )}
          {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={acting}
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={runAction}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                confirmAction === 'lost' ? 'bg-red-600 hover:bg-red-700' : 'gradient-bg hover:opacity-90'
              }`}
            >
              {acting ? 'Working…' : confirmAction === 'won' ? 'Mark won' : confirmAction === 'lost' ? 'Mark lost' : 'Reopen'}
            </button>
          </div>
        </div>
      </Modal>

      <main className="mx-auto flex max-w-[1280px] flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <ProposalEditProvider mode="preview" proposal={proposal} lineItems={lineItems}>
            <ProposalDocument
              proposal={proposal}
              client={client}
              lineItems={lineItems}
              contractDocs={contractDocs}
              signatures={signatures}
              settings={settings}
            />
          </ProposalEditProvider>
        </div>

        <aside className="w-full shrink-0 space-y-4 lg:w-80 print:hidden">
          <div className="rounded-xl bg-white p-5 card-shadow">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Status</h3>
              <StatusBadge status={displayStatus} />
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-gray-400">Created</dt>
                <dd className="text-gray-700">{new Date(proposal.created_at).toLocaleDateString()}</dd>
              </div>
              {proposal.sent_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Sent</dt>
                  <dd className="text-gray-700">{new Date(proposal.sent_at).toLocaleDateString()}</dd>
                </div>
              )}
              {proposal.first_viewed_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">First viewed</dt>
                  <dd className="text-gray-700">{new Date(proposal.first_viewed_at).toLocaleDateString()}</dd>
                </div>
              )}
              {proposal.valid_until && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Valid until</dt>
                  <dd className={displayStatus === 'expired' ? 'font-medium text-amber-600' : 'text-gray-700'}>
                    {new Date(`${proposal.valid_until}T12:00:00`).toLocaleDateString()}
                  </dd>
                </div>
              )}
              {proposal.client_signed_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-400">Client signed</dt>
                  <dd className="text-gray-700">{new Date(proposal.client_signed_at).toLocaleDateString()}</dd>
                </div>
              )}
              {proposal.lost_reason && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-gray-400">Lost reason</dt>
                  <dd className="text-right text-gray-700">{proposal.lost_reason}</dd>
                </div>
              )}
            </dl>
            {displayStatus === 'expired' && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                This proposal passed its valid-until date. Extend validity when sending again.
              </p>
            )}
          </div>

          <div className="rounded-xl bg-white p-5 card-shadow">
            <h3 className="text-sm font-semibold text-gray-900">Actions</h3>
            <div className="mt-3 space-y-2">
              {!isSigned && (
                <button
                  type="button"
                  onClick={() => navigate(`/proposals/${proposal.id}/edit`)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit proposal
                </button>
              )}
              {!isClosed && (
                <button
                  type="button"
                  onClick={() => setConfirmAction('won')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <Trophy className="h-3.5 w-3.5" />
                  Mark won
                </button>
              )}
              {!isClosed && (
                <button
                  type="button"
                  onClick={() => setConfirmAction('lost')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Mark lost
                </button>
              )}
              {proposal.status === 'lost' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction('reopen')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </button>
              )}
            </div>
            <p className="mt-3 text-[11px] text-gray-400">
              Sending, public link, and client signing are coming in the next update.
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 card-shadow">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Activity</h3>
            <ProposalActivityTimeline events={events} />
          </div>
        </aside>
      </main>
    </div>
  );
}
