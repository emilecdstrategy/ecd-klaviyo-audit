import { useEffect, useState } from 'react';
import { ExternalLink, HelpCircle, X } from 'lucide-react';

const SHOPIFY_DEV_DASHBOARD_HELP =
  'https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens';

type ShopifyTokenHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export function ShopifyTokenHelpModal({ open, onClose }: ShopifyTokenHelpModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="shopify-token-help-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="relative z-10 flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="shopify-token-help-title" className="text-base font-semibold text-gray-900">
              How to get Shopify API credentials
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Legacy pasteable tokens were retired in 2026. You now use an app's{' '}
              <span className="font-mono text-gray-700">Client ID</span> and{' '}
              <span className="font-mono text-gray-700">Client secret</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-700">
          <ol className="list-decimal space-y-3 pl-5 marker:font-semibold marker:text-brand-primary">
            <li>
              In the Shopify <span className="font-medium text-gray-900">Dev Dashboard</span>, create an app (or open an
              existing one) and add the Admin API scopes{' '}
              <strong className="font-semibold text-gray-900">read_orders</strong>,{' '}
              <strong className="font-semibold text-gray-900">read_products</strong> and{' '}
              <strong className="font-semibold text-gray-900">read_analytics</strong>. Read-only is enough; the audit
              never writes to the store.
            </li>
            <li>
              Install the app on the store you want to audit so those scopes are granted.
            </li>
            <li>
              Open the app's <span className="font-medium text-gray-900">Settings → Credentials</span> and copy the{' '}
              <span className="font-medium text-gray-900">Client ID</span> and{' '}
              <span className="font-medium text-gray-900">Client secret</span> (starts with{' '}
              <span className="font-mono text-gray-700">shpss_</span>).
            </li>
            <li>
              Paste both here with the store's <span className="font-mono text-gray-700">.myshopify.com</span> domain,
              then click <span className="font-medium text-gray-900">Test connection</span>. We exchange them for a
              short-lived token each time the audit runs.
            </li>
          </ol>

          <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900">
            <strong className="font-semibold">Same-organization only:</strong> the Client ID + secret method works when
            the app and the store are in the same Shopify organization. For a client's store in a different org, the app
            has to be installed there via OAuth instead.
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Official guide:{' '}
            <a
              href={SHOPIFY_DEV_DASHBOARD_HELP}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-primary hover:underline"
            >
              Get API access tokens (Shopify Dev)
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3 opacity-70" aria-hidden />
            </a>
          </p>
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg gradient-bg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

type ShopifyTokenHelpTriggerProps = {
  className?: string;
  label?: string;
};

/** Opens the Shopify token help modal. Manages open state internally. */
export function ShopifyTokenHelpTrigger({ className, label = 'How to get API credentials' }: ShopifyTokenHelpTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'inline-flex items-center gap-1.5 text-sm font-medium text-brand-primary transition-colors hover:text-brand-primary-dark hover:underline'
        }
      >
        <HelpCircle className="h-4 w-4 shrink-0" aria-hidden />
        {label}
      </button>
      <ShopifyTokenHelpModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
