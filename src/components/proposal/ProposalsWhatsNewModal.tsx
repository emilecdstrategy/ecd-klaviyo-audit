import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Sparkles, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Bump the version suffix to re-announce a future set of changes.
const STORAGE_KEY = 'ecd_proposals_whatsnew_v1';

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-bg text-white">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{children}</p>
      </div>
    </div>
  );
}

/** One-time "what's new" announcement shown on the Proposals page per user. */
export default function ProposalsWhatsNewModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const storageKey = user?.id ? `${STORAGE_KEY}:${user.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (!localStorage.getItem(storageKey)) setOpen(true);
    } catch {
      /* localStorage unavailable; skip the announcement */
    }
  }, [storageKey]);

  const dismiss = () => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={dismiss}
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposals-whatsnew-title"
      >
        <div className="relative gradient-bg px-6 pb-6 pt-6 text-white">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="inline-block rounded-full border border-white/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
            New in Proposals
          </span>
          <h2 id="proposals-whatsnew-title" className="mt-3 text-xl font-bold leading-snug">
            Two <span className="italic">upgrades</span> to the AI Assistant
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Feature icon={<Mic className="h-4 w-4" />} title="Talk, don't type">
            Click the mic in the assistant and just speak. Your words become text you can review and send.
          </Feature>
          <Feature icon={<Sparkles className="h-4 w-4" />} title="Reference past proposals">
            Say something like "Build a proposal similar to Celtic Sea Salt" and the assistant follows that
            proposal's structure.
          </Feature>

          <button
            type="button"
            onClick={dismiss}
            className="mt-1 w-full rounded-full px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#ef2b93', boxShadow: '0 6px 20px rgba(239,43,147,0.35)' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
