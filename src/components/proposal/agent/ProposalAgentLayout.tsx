import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useProposalAgent } from './ProposalAgentContext';
import ProposalAgentPanel from './ProposalAgentPanel';

/**
 * Flex-row wrapper that lets the agent panel push the page content aside on
 * desktop (Shopify Sidekick style). Mount inside ProposalAgentProvider.
 */
export function ProposalAgentLayout({
  children,
  blockTitles,
  itemNames,
}: {
  children: ReactNode;
  blockTitles?: Map<string, string>;
  itemNames?: Map<string, string>;
}) {
  return (
    <div className="flex min-h-screen">
      <div className="min-w-0 flex-1">{children}</div>
      <ProposalAgentPanel blockTitles={blockTitles} itemNames={itemNames} />
    </div>
  );
}

/** Header toggle button for the agent panel. */
export function AgentToggleButton({ className }: { className?: string }) {
  const { isOpen, toggle } = useProposalAgent();
  return (
    <button
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
        isOpen
          ? 'border-brand-primary/40 bg-brand-primary/10 text-brand-primary'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      AI Assistant
    </button>
  );
}
