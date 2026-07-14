import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ModalProps = {
  open: boolean;
  title?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
};

export default function Modal({ open, title, children, onClose, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn('flex max-h-[90vh] w-full max-w-3xl flex-col bg-white rounded-xl shadow-xl border border-gray-100', className)}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-gray-900 truncate">{title}</h2>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors inline-flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </div>
      </div>
    </div>,
    document.body,
  );
}

