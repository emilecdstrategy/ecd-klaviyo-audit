import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Download, FileX2, PenLine } from 'lucide-react';
import AppPreloader from '../components/ui/AppPreloader';
import ProposalDocument from '../components/proposal/ProposalDocument';
import SignaturePad, { type SignaturePadHandle } from '../components/proposal/SignaturePad';
import { ProposalEditProvider } from '../components/proposal/edit/ProposalEditContext';
import {
  DEFAULT_PROPOSAL_SETTINGS,
  fetchPublicProposal,
  mergeProposalSettings,
  signProposalPublic,
  type PublicProposalPayload,
} from '../lib/proposals-db';
import { computeProposalTotals, formatProposalTotal, proposalDiscountFromRow } from '../lib/proposal-pricing';
import type { Client, Proposal, ProposalSignature } from '../lib/types';

function FullScreenNotice({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileX2;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f9f9f9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <Icon className="mx-auto mb-4 h-10 w-10 text-gray-300" />
        <h1 className="mb-2 text-lg font-bold text-gray-900">{title}</h1>
        <p className="text-sm leading-relaxed text-gray-500">{description}</p>
      </div>
    </div>
  );
}

/** Widen the public payload into the shapes the shared document tree renders. */
function toDocumentModels(payload: PublicProposalPayload): {
  proposal: Proposal;
  client: Client;
  signatures: ProposalSignature[];
} {
  const proposal = {
    id: 'public',
    client_id: 'public',
    audit_id: null,
    template_id: null,
    public_token: null,
    first_viewed_at: null,
    won_at: null,
    lost_at: null,
    lost_reason: null,
    created_by: null,
    updated_at: payload.proposal.created_at,
    ...payload.proposal,
  } as Proposal;
  const client = {
    id: 'public',
    name: payload.proposal.recipient_name,
    company_name: payload.client.company_name,
    website_url: payload.client.website_url ?? '',
    industry: '',
    esp_platform: '',
    created_by: '',
    created_at: payload.proposal.created_at,
  } as Client;
  const signatures = payload.signatures.map((sig, index) => ({
    id: `sig-${index}`,
    proposal_id: 'public',
    signer_email: '',
    signer_user_id: null,
    typed_name: sig.signer_name,
    ip_address: '',
    user_agent: '',
    ...sig,
  })) as ProposalSignature[];
  return { proposal, client, signatures };
}

function ClientSignArea({
  recipientName,
  recipientEmail,
  onSign,
  signing,
  error,
}: {
  recipientName: string;
  recipientEmail: string;
  onSign: (typedName: string, email: string, signatureImage: string) => void;
  signing: boolean;
  error: string;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [typedName, setTypedName] = useState(recipientName);
  const [email, setEmail] = useState(recipientEmail);
  const [padEmpty, setPadEmpty] = useState(true);
  const [localError, setLocalError] = useState('');

  const submit = () => {
    setLocalError('');
    if (!typedName.trim()) {
      setLocalError('Please type your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    const image = padRef.current?.toDataURL();
    if (!image) {
      setLocalError('Please draw your signature.');
      return;
    }
    onSign(typedName.trim(), email.trim(), image);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Full name</label>
          <input
            type="text"
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
      </div>
      <SignaturePad ref={padRef} onChange={setPadEmpty} />
      {(localError || error) && (
        <p className="text-sm text-red-600">{localError || error}</p>
      )}
      <button
        type="button"
        disabled={signing || padEmpty}
        onClick={submit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg gradient-bg px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        <PenLine className="h-4 w-4" />
        {signing ? 'Signing…' : 'Accept & sign'}
      </button>
      <p className="text-[11px] leading-relaxed text-gray-400">
        By signing you agree to the services, pricing, and terms in this proposal
        {` and the attached agreements. Your name, email, IP address, and timestamp are recorded.`}
      </p>
    </div>
  );
}

export default function PublicProposal() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const isPreview = new URLSearchParams(location.search).get('preview') === '1';

  const [payload, setPayload] = useState<PublicProposalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const [justSigned, setJustSigned] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const data = await fetchPublicProposal(token, { preview: isPreview });
    if (!data) setNotFound(true);
    else setPayload(data);
    setLoading(false);
  }, [token, isPreview]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSign = async (typedName: string, email: string, signatureImage: string) => {
    if (!token) return;
    setSigning(true);
    setSignError('');
    const result = await signProposalPublic({
      token,
      typed_name: typedName,
      signer_email: email,
      signature_image: signatureImage,
    });
    if (result.ok) {
      setJustSigned(true);
      await load();
    } else if (result.code === 'already_signed') {
      await load();
    } else if (result.code === 'expired') {
      setSignError('This proposal has expired. Please contact ECD to renew it.');
    } else {
      setSignError(result.message || 'Signing failed. Please try again.');
    }
    setSigning(false);
  };

  if (loading) return <AppPreloader />;

  if (notFound || !payload) {
    return (
      <FullScreenNotice
        icon={FileX2}
        title="Proposal not found"
        description="This link is invalid or the proposal is no longer available. Please check the link or contact ECD Digital Strategy."
      />
    );
  }

  const { proposal, client, signatures } = toDocumentModels(payload);
  const settings = {
    ...DEFAULT_PROPOSAL_SETTINGS,
    ...mergeProposalSettings({ cover: payload.settings.cover }),
  };
  const isSigned = Boolean(payload.proposal.client_signed_at);
  const canSign = !isSigned && !payload.expired &&
    (payload.proposal.status === 'sent' || payload.proposal.status === 'viewed');

  if (payload.expired && !isSigned) {
    return (
      <FullScreenNotice
        icon={Clock}
        title="This proposal has expired"
        description="The acceptance window for this proposal has passed. Contact ECD Digital Strategy to receive an updated proposal."
      />
    );
  }

  const totals = computeProposalTotals(payload.line_items, proposalDiscountFromRow(proposal));
  const totalParts: string[] = [];
  if (totals.oneTimeTotal > 0 || totals.oneTimeHasLabelOnly) {
    totalParts.push(formatProposalTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly));
  }
  if (totals.monthlyTotal > 0) totalParts.push(`${formatProposalTotal(totals.monthlyTotal, false)}/mo`);

  const scrollToSignature = () => {
    document.getElementById('proposal-signatures')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="min-h-screen bg-[#f4f4f8] print:bg-white">
      <div className="mx-auto flex max-w-[880px] justify-end px-5 pt-6 sm:px-8 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" />
          Download PDF
        </button>
      </div>
      <main className="proposal-print-page mx-auto max-w-[880px] px-5 py-8 pb-32 sm:px-8 print:max-w-none print:px-0 print:py-0 print:pb-0">
        {(isSigned || justSigned) && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 print:hidden">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                {justSigned ? 'Thank you! This proposal has been signed.' : 'This proposal has been signed.'}
              </p>
              <p className="mt-0.5 text-xs text-emerald-700">
                {payload.proposal.countersigned_at
                  ? 'Fully executed by both parties.'
                  : 'A countersigned copy will follow from ECD Digital Strategy.'}
              </p>
            </div>
          </div>
        )}

        <ProposalEditProvider mode="public" proposal={proposal} lineItems={payload.line_items}>
          <ProposalDocument
            proposal={proposal}
            client={client}
            lineItems={payload.line_items}
            contractDocs={[]}
            signatures={signatures}
            settings={settings}
            collapsibleContracts
            clientSignArea={
              canSign ? (
                <ClientSignArea
                  recipientName={payload.proposal.recipient_name}
                  recipientEmail={payload.proposal.recipient_email ?? ''}
                  onSign={handleSign}
                  signing={signing}
                  error={signError}
                />
              ) : undefined
            }
          />
        </ProposalEditProvider>
      </main>

      {(canSign || justSigned) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-[880px] items-center justify-between gap-4 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
            {justSigned ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-800">Thank you! This proposal has been signed.</p>
                  <p className="text-xs text-emerald-700">A countersigned copy will follow from ECD Digital Strategy.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total</p>
                  <p className="truncate text-base font-bold tabular-nums text-gray-900">
                    {totalParts.join(' + ') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={scrollToSignature}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg gradient-bg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <PenLine className="h-4 w-4" />
                  Accept & sign
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
