import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';

export type DemoPopupState = {
  url: string;
  title?: string;
};

type DemoPopupModalProps = {
  demo: DemoPopupState | null;
  onClose: () => void;
};

export default function DemoPopupModal({ demo, onClose }: DemoPopupModalProps) {
  useEffect(() => {
    if (!demo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [demo, onClose]);

  if (!demo) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={demo.title ? `Live demo: ${demo.title}` : 'Live demo'}
    >
      <div
        className="flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {demo.title ? `Live demo — ${demo.title}` : 'Live demo'}
            </p>
            <p className="text-xs text-gray-500 truncate">{demo.url}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={demo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Open in new tab
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close demo"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <iframe
          src={demo.url}
          title={demo.title ? `Live demo: ${demo.title}` : 'Live demo'}
          className="min-h-0 flex-1 w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="fullscreen"
        />
      </div>
    </div>,
    document.body,
  );
}
