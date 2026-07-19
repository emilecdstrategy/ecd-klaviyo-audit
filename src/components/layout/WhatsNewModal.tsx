import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Mic, PenLine, Sparkles, Wand2, X, type LucideProps } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

type Feature = { icon: ComponentType<LucideProps>; title: string; desc: string };
type Entry = { id: string; title: string; features: Feature[] };

// Announcements, NEWEST FIRST. To announce something new later, prepend an entry
// with a fresh id. Users see every entry they have not dismissed yet; if they are
// already caught up they see nothing.
const ENTRIES: Entry[] = [
  {
    id: 'documents-2026-07',
    title: 'Documents: create, send, and sign',
    features: [
      {
        icon: FileText,
        title: 'A new Documents workspace',
        desc: 'Write a document (or let the AI assistant draft it), send it to anyone by email, and they sign it online. Everything, edit, send, and sign, lives on one page.',
      },
      {
        icon: PenLine,
        title: 'Built-in e-signatures',
        desc: 'Recipients sign from a link. You can add your own signature too, before or after they sign. Viewed and signed events are tracked automatically.',
      },
    ],
  },
  {
    id: 'ai-memory-2026-07',
    title: 'The AI assistants now have memory',
    features: [
      {
        icon: Sparkles,
        title: 'Knows your history',
        desc: 'The proposal assistant automatically pulls in a client\'s past proposals, audit findings, and chosen add-ons, so new drafts pick up where you left off.',
      },
      {
        icon: Wand2,
        title: 'Your house voice',
        desc: 'Set a Voice & style profile in Settings, or generate it from your past work, and every draft matches how you write.',
      },
    ],
  },
  {
    id: 'proposals-ai-2026-06',
    title: 'AI assistant upgrades for Proposals',
    features: [
      { icon: Mic, title: 'Talk, don\'t type', desc: 'Click the mic in the assistant and just speak; your words become text you can review and send.' },
      { icon: FileText, title: 'Upload a PDF', desc: 'Attach a pitch deck or brief and the assistant reads it, then drafts or edits your proposal from what\'s inside.' },
    ],
  },
];

const SEEN_KEY = 'ecd_whatsnew_seen';
// Legacy per-user keys from the old Proposals-only modal. If a user dismissed the
// latest proposals wave, treat the proposals entry as already seen.
const LEGACY_PROPOSALS_V2 = 'ecd_proposals_whatsnew_v2';

function readSeen(userId: string): Set<string> {
  const seen = new Set<string>();
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}:${userId}`);
    if (raw) for (const id of JSON.parse(raw) as string[]) seen.add(id);
    if (localStorage.getItem(`${LEGACY_PROPOSALS_V2}:${userId}`)) seen.add('proposals-ai-2026-06');
  } catch {
    /* localStorage unavailable */
  }
  return seen;
}

function Feature({ icon: Icon, title, desc }: Feature) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-bg text-white">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-500">{desc}</p>
      </div>
    </div>
  );
}

/** App-wide "what's new" announcement, shown once per user until dismissed.
 * Aggregates every unseen announcement. */
export default function WhatsNewModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState<Entry[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    const seen = readSeen(user.id);
    const pending = ENTRIES.filter(e => !seen.has(e.id));
    if (pending.length > 0) {
      setUnseen(pending);
      setOpen(true);
    }
  }, [user?.id]);

  const dismiss = () => {
    if (user?.id) {
      try {
        const seen = readSeen(user.id);
        for (const e of ENTRIES) seen.add(e.id);
        localStorage.setItem(`${SEEN_KEY}:${user.id}`, JSON.stringify([...seen]));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const headline = useMemo(() => (unseen.length > 1 ? "Here's what's new" : unseen[0]?.title ?? "What's new"), [unseen]);

  if (!open || unseen.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={dismiss} role="presentation">
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsnew-title"
      >
        <div className="relative gradient-bg px-6 pb-6 pt-6 text-white">
          <button type="button" onClick={dismiss} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white">
            <X className="h-4 w-4" />
          </button>
          <span className="inline-block rounded-full border border-white/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/90">
            What's new
          </span>
          <h2 id="whatsnew-title" className="mt-3 text-xl font-bold leading-snug">{headline}</h2>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {unseen.map((entry, i) => (
            <div key={entry.id} className="space-y-4">
              {unseen.length > 1 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">{entry.title}</p>
              )}
              {entry.features.map((f, j) => <Feature key={`${i}-${j}`} {...f} />)}
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-full px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
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
