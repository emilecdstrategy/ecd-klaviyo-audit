import { PenLine } from 'lucide-react';
import type { ProposalSignature } from '../../lib/types';
import type { ReactNode } from 'react';

function SignatureSlot({
  roleLabel,
  signature,
  placeholderName,
  liveArea,
}: {
  roleLabel: string;
  signature: ProposalSignature | null;
  placeholderName?: string;
  /** Live signing UI (public page) injected in place of the placeholder. */
  liveArea?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{roleLabel}</p>
      {signature ? (
        <div className="mt-2">
          <img
            src={signature.signature_image}
            alt={`${signature.signer_name} signature`}
            className="h-16 w-auto max-w-full object-contain object-left"
          />
          <div className="mt-1 border-t border-gray-300 pt-1.5">
            <p className="text-sm font-semibold text-gray-900">{signature.signer_name}</p>
            <p className="text-xs text-gray-500">
              Signed {new Date(signature.signed_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
      ) : liveArea ? (
        <div className="mt-2">{liveArea}</div>
      ) : (
        <div className="mt-2">
          <div className="flex h-16 items-end">
            <div className="w-full border-b border-gray-300" />
          </div>
          <div className="mt-1.5">
            <p className="text-sm font-medium text-gray-400">{placeholderName || 'Name'}</p>
            <p className="text-xs text-gray-400">Date</p>
          </div>
        </div>
      )}
    </div>
  );
}

type ProposalSignatureSectionProps = {
  clientSignature: ProposalSignature | null;
  agencySignature: ProposalSignature | null;
  recipientName?: string;
  clientLiveArea?: ReactNode;
};

export default function ProposalSignatureSection({
  clientSignature,
  agencySignature,
  recipientName,
  clientLiveArea,
}: ProposalSignatureSectionProps) {
  return (
    <section id="proposal-signatures" className="proposal-section rounded-2xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 ring-1 ring-brand-primary/15">
          <PenLine className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Acceptance</h2>
          <p className="text-sm text-gray-500">
            By signing below, both parties agree to the services, pricing, and terms in this proposal.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:gap-12">
        <SignatureSlot
          roleLabel="Client"
          signature={clientSignature}
          placeholderName={recipientName}
          liveArea={clientLiveArea}
        />
        <SignatureSlot
          roleLabel="ECD Digital Strategy"
          signature={agencySignature}
        />
      </div>
    </section>
  );
}
