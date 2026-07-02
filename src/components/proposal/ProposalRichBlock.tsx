import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import ProposalPlainText from './edit/ProposalPlainText';
import ProposalRichText from './edit/ProposalRichText';
import { useProposalEdit } from './edit/ProposalEditContext';
import type { ProposalBlock } from '../../lib/types';

type ProposalRichBlockProps = {
  block: ProposalBlock;
  isFirst: boolean;
  isLast: boolean;
};

export default function ProposalRichBlock({ block, isFirst, isLast }: ProposalRichBlockProps) {
  const { editMode, updateBlock, addBlock, removeBlock, moveBlock } = useProposalEdit();

  return (
    <section className="proposal-section group/block relative">
      {editMode && (
        <div className="absolute -right-2 -top-2 z-10 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-1 opacity-0 shadow-sm transition-opacity group-hover/block:opacity-100 focus-within:opacity-100 print:hidden">
          <button
            type="button"
            onClick={() => moveBlock(block.key, -1)}
            disabled={isFirst}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-30"
            title="Move section up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => moveBlock(block.key, 1)}
            disabled={isLast}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-30"
            title="Move section down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => removeBlock(block.key)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Remove section"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <ProposalPlainText
        value={block.title}
        onSave={editMode ? value => updateBlock(block.key, { title: value }) : undefined}
        as="h2"
        placeholder="Section title"
        className="text-xl font-bold tracking-tight text-gray-900"
      />
      <div className="mt-3">
        <ProposalRichText
          value={block.content}
          onSave={editMode ? value => updateBlock(block.key, { content: value }) : undefined}
          placeholder="Write this section…"
          className="text-[15px] leading-relaxed text-gray-700 space-y-3"
        />
      </div>

      {editMode && (
        <div className="mt-4 flex justify-center opacity-0 transition-opacity group-hover/block:opacity-100 print:hidden">
          <button
            type="button"
            onClick={() => addBlock(block.key)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-400 hover:border-brand-primary/40 hover:text-brand-primary"
          >
            <Plus className="h-3 w-3" />
            Add section below
          </button>
        </div>
      )}
    </section>
  );
}
