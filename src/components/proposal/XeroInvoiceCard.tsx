import { useState } from 'react';
import { ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react';
import { createXeroDraftInvoice, xeroInvoiceUrl } from '../../lib/xero';
import { useToast } from '../ui/Toast';
import type { Proposal } from '../../lib/types';

/** The Xero draft invoice for a signed proposal: link it, or retry a failure. */
export default function XeroInvoiceCard({
  proposal,
  onChanged,
}: {
  proposal: Proposal;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const { invoice_number } = await createXeroDraftInvoice(proposal.id);
      toast(`Draft invoice ${invoice_number || ''} created in Xero`.trim());
      onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create the invoice';
      // "not connected" is a setup state, not a failure worth alarming about.
      toast(message.includes('not connected') ? 'Connect Xero first, under Settings > API Connection.' : message);
    } finally {
      setBusy(false);
    }
  };

  const invoiced = Boolean(proposal.xero_invoice_id);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-gray-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Xero</h3>
      </div>

      {invoiced ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-900">
            Draft invoice {proposal.xero_invoice_number ? `#${proposal.xero_invoice_number}` : 'created'}
          </p>
          {proposal.xero_invoiced_at && (
            <p className="text-[11px] text-gray-400">
              {new Date(proposal.xero_invoiced_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
          <a
            href={xeroInvoiceUrl(proposal.xero_invoice_id!)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Open in Xero <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <p className="mt-2 text-[11px] text-gray-400">
            It is a draft, so nothing has been emailed to the client. Approve and send it from Xero.
          </p>
        </div>
      ) : (
        <div className="mt-2">
          {proposal.xero_invoice_error ? (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              Last attempt failed: {proposal.xero_invoice_error}
            </p>
          ) : (
            <p className="text-xs text-gray-500">No draft invoice yet.</p>
          )}
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg gradient-bg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {proposal.xero_invoice_error ? 'Try again' : 'Create draft invoice'}
          </button>
        </div>
      )}
    </div>
  );
}
