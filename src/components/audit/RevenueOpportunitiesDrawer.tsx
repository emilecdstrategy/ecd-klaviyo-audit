import { type ReactNode } from 'react';
import { X } from 'lucide-react';

export function RevenueOpportunitiesDrawer({
  open,
  onClose,
  title = 'Revenue opportunities',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="Close revenue opportunities"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-[min(100vw,72rem)] flex-col bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Select an add-on on the left to edit. Changes save automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
