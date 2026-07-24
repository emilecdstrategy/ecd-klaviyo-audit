import { Plus, Check } from 'lucide-react';
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
  /** Required in the proposal variant (drives the cover); omitted for templates. */
  client?: Client;
  lineItems: ProposalLineItem[];
  /** Live contract docs (draft) — superseded by contracts_snapshot once sent. */
  contractDocs: ContractDocument[];
  signatures?: ProposalSignature[];
  settings?: ProposalSettings;
  /** Public page: live client signing UI injected into the signature slot. */
  clientSignArea?: ReactNode;
  /** Which client signer slot the live signing UI belongs to (public page). */
  liveSignerIndex?: 1 | 2;
  /** Collapse long contracts behind a disclosure (public mobile). */
  collapsibleContracts?: boolean;
  /**
   * 'template' reuses the same editable surface (text sections, pricing,
   * contracts) for a proposal_templates row, hiding the cover and signature
   * blocks that only make sense on a real client-bound proposal.
   */
  variant?: 'proposal' | 'template';
};

export default function ProposalDocument({
  proposal,
  client,
  lineItems,
  contractDocs,
  signatures = [],
  settings,
  clientSignArea,
  liveSignerIndex = 1,
  collapsibleContracts = false,
  variant = 'proposal',
}: ProposalDocumentProps) {
  const { editMode, addBlock, toggleContract } = useProposalEdit();
  const isTemplate = variant === 'template';

  const clientSignatureAt = (index: number) =>
    signatures.find(s => s.role === 'client' && (s.signer_index ?? 1) === index) ?? null;
  const agencySignature = signatures.find(s => s.role === 'agency') ?? null;

  // A second slot renders when a second signer is configured (or has already signed).
  const hasSecondSigner = Boolean(proposal.recipient2_email) || Boolean(clientSignatureAt(2));
  const clientSlots = [
    {
      signature: clientSignatureAt(1),
      placeholderName: proposal.recipient_name,
      liveArea: liveSignerIndex === 1 ? clientSignArea : undefined,
    },
    ...(hasSecondSigner
      ? [{
          signature: clientSignatureAt(2),
          placeholderName: proposal.recipient2_name,
          liveArea: liveSignerIndex === 2 ? clientSignArea : undefined,
        }]
      : []),
  ];

  // Once sent, contracts render from the frozen snapshot; drafts use the live docs.
  const includedContracts = (proposal.contracts_snapshot ?? contractDocs
    .filter(doc => proposal.include_contracts.includes(doc.slug))
    .map(doc => ({ slug: doc.slug, name: doc.name, content: doc.content, version_updated_at: doc.updated_at }))
  ).filter(doc => proposal.include_contracts.includes(doc.slug));

  return (
    <div className="proposal-print-root space-y-8">
      {!isTemplate && client && settings && (
        <ProposalCover proposal={proposal} client={client} settings={settings} />
      )}

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

      <ProposalPricingTable proposal={proposal} lineItems={lineItems} clientWebsite={client?.website_url ?? null} />

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
                aria-pressed={included}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  included
                    ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                    included ? 'border-brand-primary bg-brand-primary' : 'border-gray-300 bg-white'
                  }`}
                >
                  {included && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                </span>
                {doc.name}
              </button>
            );
          })}
        </div>
      )}

      {includedContracts.map(doc => (
        <ProposalContractSection
          key={doc.slug}
          id={`contract-${doc.slug}`}
          name={doc.name}
          content={doc.content}
          collapsible={collapsibleContracts}
        />
      ))}

      {!isTemplate && (
        <ProposalSignatureSection
          clientSlots={clientSlots}
          agencySignature={agencySignature}
        />
      )}
    </div>
  );
}
