import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Mic, Sparkles, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// One localStorage key per announcement "wave". A user who never saw v1 gets a
// combined popup (v1 + v2 features); a user who already dismissed v1 gets only
// the v2 (PDF) announcement. Bump with a new key to announce a future set.
const V1_KEY = 'ecd_proposals_whatsnew_v1';
const V2_KEY = 'ecd_proposals_whatsnew_v2';

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
  // 'combined' = user hasn't seen v1 yet, show everything. 'pdf' = they saw v1,
  // show only the new PDF feature.
  const [variant, setVariant] = useState<'combined' | 'pdf'>('combined');

  const v1Key = user?.id ? `${V1_KEY}:${user.id}` : null;
  const v2Key = user?.id ? `${V2_KEY}:${user.id}` : null;

  useEffect(() => {
    if (!v1Key || !v2Key) return;
    try {
      const seenV1 = Boolean(localStorage.getItem(v1Key));
      const seenV2 = Boolean(localStorage.getItem(v2Key));
      if (seenV2) return; // caught up on everything
      setVariant(seenV1 ? 'pdf' : 'combined');
      setOpen(true);
    } catch {
      /* localStorage unavailable; skip the announcement */
    }
  }, [v1Key, v2Key]);

  const dismiss = () => {
    try {
      const now = new Date().toISOString();
      // Always mark the latest wave seen; when it was the combined popup, also
      // mark v1 so it never reappears.
      if (v2Key) localStorage.setItem(v2Key, now);
      if (variant === 'combined' && v1Key) localStorage.setItem(v1Key, now);
    } catch {
      /* ignore */
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

  const combined = variant === 'combined';

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
            {combined ? (
              <>
                Three <span className="italic">upgrades</span> to the AI Assistant
              </>
            ) : (
              <>
                Upload <span className="italic">PDFs</span> to the AI Assistant
              </>
            )}
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          {combined && (
            <>
              <Feature icon={<Mic className="h-4 w-4" />} title="Talk, don't type">
                Click the mic in the assistant and just speak. Your words become text you can review and send.
              </Feature>
              <Feature icon={<Sparkles className="h-4 w-4" />} title="Reference past proposals">
                Say something like "Build a proposal similar to Celtic Sea Salt" and the assistant follows that
                proposal's structure.
              </Feature>
            </>
          )}
          <Feature icon={<FileText className="h-4 w-4" />} title="Upload a PDF">
            Attach a pitch deck or brief with the paperclip and the assistant reads it, then drafts or edits
            your proposal from what's inside.
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
