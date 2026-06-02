import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, HelpCircle, Info, X } from 'lucide-react';

const KLAVIYO_ATTRIBUTION_URL = 'https://www.klaviyo.com/settings/attribution';

const GUIDE_IMAGES = {
  attributionWindows: '/guides/attribution-model/attribution-windows.png',
  trackingReporting: '/guides/attribution-model/tracking-reporting.png',
  last30Days: '/guides/attribution-model/last-30-days.png',
  comparisonExample: '/guides/attribution-model/comparison-example.png',
} as const;

type AttributionModelHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

function GuideImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm">
      <img src={src} alt={alt} className="block w-full h-auto" loading="lazy" />
    </div>
  );
}

export function AttributionModelHelpModal({ open, onClose }: AttributionModelHelpModalProps) {
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
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attribution-help-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="relative z-10 flex max-h-[min(92vh,820px)] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="attribution-help-title" className="text-base font-semibold text-gray-900">
              How to get the Attribution Model screenshot
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Follow these steps in the client&apos;s Klaviyo account, then upload the comparison view below.
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
          <div className="mb-5 flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
            <Info className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden />
            <div>
              <p className="font-semibold text-emerald-900">Already matches ECD standards?</p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-800/90">
                If this account is already configured with our recommended attribution windows, tracking
                settings, and <strong>Last 30 days</strong> as shown in the steps below, you do not need to
                add a screenshot — leave this section empty and it will stay hidden on the published report.
              </p>
            </div>
          </div>

          <ol className="space-y-6">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                1
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Open Klaviyo Attribution settings</p>
                <p className="mt-1 leading-relaxed">
                  In the client&apos;s Klaviyo account, go to{' '}
                  <span className="font-medium text-gray-900">Settings → Attribution</span>.
                </p>
                <a
                  href={KLAVIYO_ATTRIBUTION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-primary/20 bg-brand-primary/5 px-3 py-1.5 text-xs font-semibold text-brand-primary hover:bg-brand-primary/10"
                >
                  Open Attribution settings
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                2
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Click Compare model</p>
                <p className="mt-1 leading-relaxed">
                  On the Attribution page, click the <strong>Compare model</strong> button to open the
                  side-by-side preview.
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                3
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Set Attribution windows</p>
                <p className="mt-1 leading-relaxed">
                  Configure <strong>Attribution windows</strong> to match ECD standards:
                </p>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-primary mt-0.5" />
                    Opened email — <strong>5 days</strong> (enabled)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-primary mt-0.5" />
                    Clicked email — <strong>5 days</strong> (enabled)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-gray-400 mt-0.5" />
                    Delivered text message — unchecked
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-primary mt-0.5" />
                    Clicked text message — <strong>1 day</strong> (enabled)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-primary mt-0.5" />
                    Non-Klaviyo Active on site — <strong>1 day</strong> (enabled)
                  </li>
                </ul>
                <GuideImage src={GUIDE_IMAGES.attributionWindows} alt="Attribution windows configuration example" />
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                4
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Set Tracking and reporting data</p>
                <p className="mt-1 leading-relaxed">
                  Under <strong>Tracking and reporting data</strong>, enable only the two bot-interaction
                  exclusions (as shown):
                </p>
                <GuideImage
                  src={GUIDE_IMAGES.trackingReporting}
                  alt="Tracking and reporting data configuration example"
                />
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                5
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Select Last 30 days</p>
                <p className="mt-1 leading-relaxed">
                  In the comparison toolbar, set the date range to <strong>Last 30 days</strong>.
                </p>
                <GuideImage src={GUIDE_IMAGES.last30Days} alt="Last 30 days date range selector" />
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">
                6
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">Capture and upload the comparison screenshot</p>
                <p className="mt-1 leading-relaxed">
                  Take a full-width screenshot of the <strong>Current model</strong> vs{' '}
                  <strong>Preview model</strong> comparison (metric: Placed Order, view: Revenue). Upload it
                  in the Attribution Model section above using click, drag & drop, or Ctrl+V.
                </p>
                <p className="mt-2 text-xs font-medium text-gray-500">Example of what to capture:</p>
                <GuideImage
                  src={GUIDE_IMAGES.comparisonExample}
                  alt="Example attribution model comparison screenshot"
                />
              </div>
            </li>
          </ol>
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg gradient-bg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

type AttributionModelHelpTriggerProps = {
  className?: string;
  label?: string;
};

/** Edit-mode only — opens the attribution screenshot how-to guide. */
export function AttributionModelHelpTrigger({
  className,
  label = 'How to get this screenshot',
}: AttributionModelHelpTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:border-brand-primary/30 hover:text-brand-primary'
        }
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
        {label}
      </button>
      <AttributionModelHelpModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
