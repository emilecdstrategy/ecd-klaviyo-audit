import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';

export default function AddOnHighlightRegenModal({
  open,
  running,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  running?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Dismiss"
        onClick={running ? undefined : onDismiss}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Regenerate for highlighted add-ons?</h3>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Highlighted add-ons changed after this audit was generated. We can re-run AI for the
              executive summary, Key Findings, implementation timeline, and only the report sections
              related to those add-ons.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Manual edits to those areas will be overwritten. What&apos;s Working and unrelated sections
              are preserved. Add-on pricing and screenshots stay as-is.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={running}
            onClick={onDismiss}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={running}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
