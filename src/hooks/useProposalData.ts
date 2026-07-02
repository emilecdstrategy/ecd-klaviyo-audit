import { useCallback, useEffect, useState } from 'react';
import {
  getProposal,
  getProposalSettings,
  listContractDocuments,
  listProposalEvents,
  listProposalLineItems,
  listProposalSignatures,
} from '../lib/proposals-db';
import type {
  Client,
  ContractDocument,
  Proposal,
  ProposalEvent,
  ProposalLineItem,
  ProposalSettings,
  ProposalSignature,
} from '../lib/types';

export type ProposalBundle = {
  proposal: Proposal;
  client: Client;
  lineItems: ProposalLineItem[];
  contractDocs: ContractDocument[];
  signatures: ProposalSignature[];
  events: ProposalEvent[];
  settings: ProposalSettings;
};

/** Load a proposal and everything the document renderer needs (internal, authenticated). */
export function useProposalData(proposalId: string | undefined) {
  const [data, setData] = useState<ProposalBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    if (!proposalId) return;
    try {
      setLoadError('');
      const [proposal, lineItems, contractDocs, signatures, events, settings] = await Promise.all([
        getProposal(proposalId),
        listProposalLineItems(proposalId),
        listContractDocuments(),
        listProposalSignatures(proposalId),
        listProposalEvents(proposalId),
        getProposalSettings(),
      ]);
      if (!proposal || !proposal.client) {
        setLoadError('Proposal not found');
        setData(null);
        return;
      }
      setData({
        proposal,
        client: proposal.client,
        lineItems,
        contractDocs,
        signatures,
        events,
        settings,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load proposal');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { data, setData, loading, loadError, reload };
}
