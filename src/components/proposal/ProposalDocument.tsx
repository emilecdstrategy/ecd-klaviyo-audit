import { Plus } from 'lucide-react';
import ProposalCover from './ProposalCover';
import ProposalRichBlock from './ProposalRichBlock';
import ProposalPricingTable from './ProposalPricingTable';
import ProposalContractSection from './ProposalContractSection';
import ProposalSignatureSection from './ProposalSignatureSection';
import { useProposalEdit } from './edit/ProposalEditContext';
import type {
  Client,
  ContractDocument,
  Proposal,
  ProposalLineItem,
  ProposalSettings,
  ProposalSignature,
} from '../../lib/types';
import type { ReactNode } from 'react';

type ProposalDocumentProps = {
  proposal: Proposal;
  client: Client;
  lineItems: ProposalLineItem[];
  /** Live contract docs (draft) — superseded by contracts_snapshot once sent. */
  contractDocs: ContractDocument[];
  signatures: ProposalSignature[];
  settings: ProposalSettings;
  /** Public page: live client signing UI injected into the signature slot. */
  clientSignArea?: ReactNode;
  /** Collapse long contracts behind a disclosure (public mobile). */
  collapsibleContracts?: boolean;
};

export default function ProposalDocument({
  proposal,
  client,
  lineItems,
  contractDocs,
  signatures,
  settings,
  clientSignArea,
  collapsibleContracts = false,
}: ProposalDocumentProps) {
  const { editMode, addBlock, toggleContract } = useProposalEdit();

  const clientSignature = signatures.find(s => s.role === 'client') ?? null;
  const agencySignature = signatures.find(s => s.role === 'agency') ?? null;

  // Once sent, contracts render from the frozen snapshot; drafts use the live docs.
  const includedContracts = (proposal.contracts_snapshot ?? contractDocs
    .filter(doc => proposal.include_contracts.includes(doc.slug))
    .map(doc => ({ slug: doc.slug, name: doc.name, content: doc.content, version_updated_at: doc.updated_at }))
  ).filter(doc => proposal.include_contracts.includes(doc.slug));

  return (
    <div className="proposal-print-root space-y-8">
      <ProposalCover proposal={proposal} client={client} settings={settings} />

      {proposal.content_blocks.length === 0 && editMode ? (
        <div className="flex justify-center print:hidden">
          <button
            type="button"
            onClick={() => addBlock(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-4 py-2 text-xs font-medium text-gray-400 hover:border-brand-primary/40 hover:text-brand-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a text section
          </button>
        </div>
      ) : (
        proposal.content_blocks.map((block, index) => (
          <ProposalRichBlock
            key={block.key}
            block={block}
            isFirst={index === 0}
            isLast={index === proposal.content_blocks.length - 1}
          />
        ))
      )}

      <ProposalPricingTable proposal={proposal} lineItems={lineItems} />

      {editMode && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Attach contracts:
          </span>
          {contractDocs.map(doc => {
            const included = proposal.include_contracts.includes(doc.slug);
            return (
              <button
                key={doc.slug}
                type="button"
                onClick={() => toggleContract(doc.slug, !included)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  included
                    ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {doc.name}
              </button>
            );
          })}
        </div>
      )}

      {includedContracts.map(doc => (
        <ProposalContractSection
          key={doc.slug}
          name={doc.name}
          content={doc.content}
          collapsible={collapsibleContracts}
        />
      ))}

      <ProposalSignatureSection
        clientSignature={clientSignature}
        agencySignature={agencySignature}
        recipientName={proposal.recipient_name}
        clientLiveArea={clientSignArea}
      />
    </div>
  );
}
