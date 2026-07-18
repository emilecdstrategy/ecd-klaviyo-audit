import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useDocumentAgent } from './DocumentAgentContext';
import DocumentAgentPanel from './DocumentAgentPanel';

/** Wraps a page so the AI assistant panel slides in beside it (desktop) or as an
 * overlay (mobile). Mirrors ProposalAgentLayout. */
export function DocumentAgentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 w-full">
      <div className="min-w-0 flex-1">{children}</div>
      <DocumentAgentPanel />
    </div>
  );
}

export function DocAgentToggleButton({ className }: { className?: string }) {
  const { toggle, isOpen } = useDocumentAgent();
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        isOpen ? 'bg-brand-primary/10 text-brand-primary' : 'gradient-bg text-white hover:opacity-90',
        className,
      )}
    >
      <Sparkles className="h-4 w-4" />
      AI Assistant
    </button>
  );
}
