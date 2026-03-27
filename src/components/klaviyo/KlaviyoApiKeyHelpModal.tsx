import { useEffect, useState } from 'react';
import { ExternalLink, HelpCircle, X } from 'lucide-react';

const KLAVIYO_API_KEYS_URL = 'https://www.klaviyo.com/settings/account/api-keys';
const KLAVIYO_HELP_ARTICLE =
  'https://help.klaviyo.com/hc/en-us/articles/7423954176283-How-to-create-a-private-API-key';

type KlaviyoApiKeyHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export function KlaviyoApiKeyHelpModal({ open, onClose }: KlaviyoApiKeyHelpModalProps) {
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
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="klaviyo-api-help-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="relative z-10 flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="klaviyo-api-help-title" className="text-base font-semibold text-gray-900">
              How to get your Klaviyo private API key
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Private keys start with <span className="font-mono text-gray-700">pk_</span> and are only shown once when created.
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
              <span className="font-medium text-gray-900">Log in</span> to{' '}
              <a
                href="https://www.klaviyo.com/login"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-primary hover:underline"
              >
                Klaviyo
                <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3 opacity-70" aria-hidden />
              </a>
              . You must be an <strong className="font-semibold text-gray-900">Owner</strong> or{' '}
              <strong className="font-semibold text-gray-900">Admin</strong> to create private API keys.
            </li>
            <li>
              Open <span className="font-medium text-gray-900">API keys</span>: click your{' '}
              <span className="font-medium text-gray-900">organization name</span> (lower-left), choose{' '}
              <span className="font-medium text-gray-900">Settings</span>, then{' '}
              <span className="font-medium text-gray-900">API keys</span>.
              <div className="mt-2">
                <a
                  href={KLAVIYO_API_KEYS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline"
                >
                  Open API keys in Klaviyo
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>
            </li>
            <li>
              Under <span className="font-medium text-gray-900">Private API keys</span>, click{' '}
              <span className="font-medium text-gray-900">Create Private API Key</span>.
            </li>
            <li>
              Enter a <span className="font-medium text-gray-900">name</span> you will recognize (for example, “ECD Audit”).
            </li>
            <li>
              Choose a <span className="font-medium text-gray-900">scope</span>:
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-gray-600">
                <li>
                  <strong className="font-semibold text-gray-800">Full</strong> — recommended here so the audit can read flows, campaigns, segments, signup forms, lists, profiles, and reporting metrics without missing permissions.
                </li>
                <li>
                  <strong className="font-semibold text-gray-800">Read-only</strong> — may work if it covers all endpoints this tool reads; if you see scope warnings after running an audit, create a new key with <strong className="font-semibold text-gray-800">Full</strong> access.
                </li>
                <li>
                  <strong className="font-semibold text-gray-800">Custom</strong> — only if you know exactly which scopes to enable; missing scopes will limit what appears in the report.
                </li>
              </ul>
            </li>
            <li>
              Create the key, then <span className="font-medium text-gray-900">copy it immediately</span> and paste it into this app. Klaviyo does not show the full key again after you leave the screen.
            </li>
          </ol>

          <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-900">
            <strong className="font-semibold">Security:</strong> Treat the key like a password. Do not email it or post it in chat. Revoke old keys in Klaviyo when you rotate credentials.
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Official guide:{' '}
            <a
              href={KLAVIYO_HELP_ARTICLE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-primary hover:underline"
            >
              How to create a private API key (Klaviyo Help Center)
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3 opacity-70" aria-hidden />
            </a>
          </p>
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

type KlaviyoApiKeyHelpTriggerProps = {
  className?: string;
  label?: string;
};

/** Opens the Klaviyo API key help modal. Manages open state internally. */
export function KlaviyoApiKeyHelpTrigger({ className, label = 'How to get your API key' }: KlaviyoApiKeyHelpTriggerProps) {
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
      <KlaviyoApiKeyHelpModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
