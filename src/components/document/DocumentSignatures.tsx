import type { ReactNode } from 'react';

export type SignatureView = {
  signer_name: string;
  typed_name?: string;
  signature_image: string;
  signed_at: string;
} | null;

function formatSignedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SignedView({ sig, fallbackName }: { sig: NonNullable<SignatureView>; fallbackName?: string }) {
  return (
    <div className="mt-1.5">
      <div className="rounded-lg border border-gray-200 bg-white p-2">
        <img src={sig.signature_image} alt="Signature" className="h-16 w-full object-contain" />
      </div>
      <p className="mt-1.5 text-sm font-semibold text-gray-900">{sig.signer_name || fallbackName || 'Signed'}</p>
      <p className="text-xs text-gray-400">Signed {formatSignedDate(sig.signed_at)}</p>
    </div>
  );
}

function AwaitingView({ label }: { label: string }) {
  return (
    <div className="mt-1.5 flex h-[92px] items-end">
      <div className="w-full border-b border-dashed border-gray-300 pb-1 text-xs text-gray-400">{label}</div>
    </div>
  );
}

function Column({ role, name, sig, pending }: { role: string; name?: string; sig: SignatureView; pending?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{role}</p>
      {name && <p className="text-xs text-gray-500">{name}</p>}
      {sig ? <SignedView sig={sig} fallbackName={name} /> : pending ?? <AwaitingView label="Awaiting signature" />}
    </div>
  );
}

/** Two-column signature block: sender (us) on the left, recipient on the right.
 * The sender column only renders when the document has it enabled. When the
 * recipient has not signed, `recipientPending` can supply an interactive form. */
export default function DocumentSignatures({
  senderEnabled,
  sender,
  recipient,
  senderName = 'ECD Digital Strategy',
  recipientName,
  recipientPending,
  className,
}: {
  senderEnabled: boolean;
  sender: SignatureView;
  recipient: SignatureView;
  senderName?: string;
  recipientName?: string;
  recipientPending?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-gray-900">Signatures</h3>
      <div className={`mt-3 grid grid-cols-1 gap-5 ${senderEnabled ? 'sm:grid-cols-2' : ''}`}>
        {senderEnabled && <Column role="Sender" name={senderName} sig={sender} />}
        <Column role="Recipient" name={recipientName} sig={recipient} pending={recipientPending} />
      </div>
    </div>
  );
}
