import { useEffect, useState } from 'react';
import { ExternalLink, HelpCircle, X } from 'lucide-react';

const SHOPIFY_CUSTOM_APPS_HELP =
  'https://help.shopify.com/en/manual/apps/app-types/custom-apps';

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
              How to get a Shopify Admin API access token
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Tokens start with <span className="font-mono text-gray-700">shpat_</span> and are only shown once when created.
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
              In the Shopify admin, go to{' '}
              <span className="font-medium text-gray-900">Settings → Apps and sales channels → Develop apps</span>.
              The store <strong className="font-semibold text-gray-900">owner</strong> may need to click{' '}
              <span className="font-medium text-gray-900">Allow custom app development</span> first.
            </li>
            <li>
              Click <span className="font-medium text-gray-900">Create an app</span> and name it something recognizable
              (for example, "ECD Web Audit").
            </li>
            <li>
              Open <span className="font-medium text-gray-900">Configure Admin API scopes</span> and enable{' '}
              <strong className="font-semibold text-gray-900">read_orders</strong> and{' '}
              <strong className="font-semibold text-gray-900">read_products</strong>. Read-only scopes are enough; the
              audit never writes to the store.
            </li>
            <li>
              Click <span className="font-medium text-gray-900">Install app</span> in the API credentials tab.
            </li>
            <li>
              Under <span className="font-medium text-gray-900">Admin API access token</span>, click{' '}
              <span className="font-medium text-gray-900">Reveal token once</span>, copy it, and paste it into this app.
              Shopify does not show the token again.
            </li>
          </ol>

          <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900">
            <strong className="font-semibold">Security:</strong> Treat the token like a password. Do not email it or
            post it in chat. The store can uninstall the custom app at any time to revoke access.
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Official guide:{' '}
            <a
              href={SHOPIFY_CUSTOM_APPS_HELP}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-primary hover:underline"
            >
              Custom apps (Shopify Help Center)
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
export function ShopifyTokenHelpTrigger({ className, label = 'How to get an access token' }: ShopifyTokenHelpTriggerProps) {
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
