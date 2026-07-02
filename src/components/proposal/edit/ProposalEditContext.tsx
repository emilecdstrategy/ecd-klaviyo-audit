import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { scheduleSavedToast, useToast } from '../../ui/Toast';
import {
  createProposalLineItems,
  deleteProposalLineItem,
  updateProposal,
  updateProposalLineItem,
} from '../../../lib/proposals-db';
import type {
  Proposal,
  ProposalBlock,
  ProposalDiscountAppliesTo,
  ProposalDiscountType,
  ProposalLineItem,
  ProposalTemplateLineItem,
} from '../../../lib/types';

export type ProposalMode = 'edit' | 'preview' | 'public';
export type ProposalSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type ProposalEditContextValue = {
  mode: ProposalMode;
  editMode: boolean;
  saveStatus: ProposalSaveStatus;
  updateTitle: (value: string) => void;
  updateBlock: (blockKey: string, patch: Partial<Omit<ProposalBlock, 'key'>>) => void;
  addBlock: (afterKey: string | null) => void;
  removeBlock: (blockKey: string) => void;
  moveBlock: (blockKey: string, dir: -1 | 1) => void;
  updateLineItem: (itemId: string, patch: Partial<Omit<ProposalLineItem, 'id' | 'proposal_id' | 'created_at'>>) => void;
  addLineItem: (fromCatalog?: ProposalTemplateLineItem) => void;
  removeLineItem: (itemId: string) => void;
  moveLineItem: (itemId: string, dir: -1 | 1) => void;
  updateDiscount: (patch: {
    discount_type?: ProposalDiscountType;
    discount_value?: number;
    discount_applies_to?: ProposalDiscountAppliesTo;
    discount_label?: string | null;
  }) => void;
  toggleContract: (slug: string, included: boolean) => void;
};

const noop = () => {};

const READ_ONLY_VALUE: Omit<ProposalEditContextValue, 'mode' | 'editMode'> = {
  saveStatus: 'idle',
  updateTitle: noop,
  updateBlock: noop,
  addBlock: noop,
  removeBlock: noop,
  moveBlock: noop,
  updateLineItem: noop,
  addLineItem: noop,
  removeLineItem: noop,
  moveLineItem: noop,
  updateDiscount: noop,
  toggleContract: noop,
};

const ProposalEditContext = createContext<ProposalEditContextValue>({
  mode: 'preview',
  editMode: false,
  ...READ_ONLY_VALUE,
});

export function useProposalEdit(): ProposalEditContextValue {
  return useContext(ProposalEditContext);
}

function blockKey(): string {
  return `block_${Math.random().toString(36).slice(2, 9)}`;
}

type ProposalEditProviderProps = {
  mode: ProposalMode;
  proposal: Proposal;
  lineItems: ProposalLineItem[];
  onProposalChange?: (next: Proposal) => void;
  onLineItemsChange?: (next: ProposalLineItem[]) => void;
  children: ReactNode;
};

export function ProposalEditProvider({
  mode,
  proposal,
  lineItems,
  onProposalChange,
  onLineItemsChange,
  children,
}: ProposalEditProviderProps) {
  const toast = useToast();
  const [saveStatus, setSaveStatus] = useState<ProposalSaveStatus>('idle');
  const timers = useRef<Record<string, number>>({});

  const schedule = useCallback(
    (key: string, fn: () => Promise<void>) => {
      if (timers.current[key]) window.clearTimeout(timers.current[key]);
      setSaveStatus('saving');
      timers.current[key] = window.setTimeout(async () => {
        try {
          await fn();
          setSaveStatus('saved');
          scheduleSavedToast(toast);
          window.setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2500);
        } catch {
          setSaveStatus('error');
          toast('Could not save');
        }
      }, 800) as unknown as number;
    },
    [toast],
  );

  const saveProposalPatch = useCallback(
    (key: string, patch: Parameters<typeof updateProposal>[1]) => {
      onProposalChange?.({ ...proposal, ...patch } as Proposal);
      schedule(key, async () => {
        await updateProposal(proposal.id, patch);
      });
    },
    [onProposalChange, proposal, schedule],
  );

  const updateTitle = useCallback(
    (value: string) => saveProposalPatch('title', { title: value }),
    [saveProposalPatch],
  );

  const updateBlock = useCallback(
    (key: string, patch: Partial<Omit<ProposalBlock, 'key'>>) => {
      const blocks = proposal.content_blocks.map(b => (b.key === key ? { ...b, ...patch } : b));
      saveProposalPatch('blocks', { content_blocks: blocks });
    },
    [proposal.content_blocks, saveProposalPatch],
  );

  const addBlock = useCallback(
    (afterKey: string | null) => {
      const blocks = [...proposal.content_blocks];
      const newBlock: ProposalBlock = { key: blockKey(), title: 'New section', content: '' };
      const index = afterKey ? blocks.findIndex(b => b.key === afterKey) : -1;
      if (index >= 0) blocks.splice(index + 1, 0, newBlock);
      else blocks.push(newBlock);
      saveProposalPatch('blocks', { content_blocks: blocks });
    },
    [proposal.content_blocks, saveProposalPatch],
  );

  const removeBlock = useCallback(
    (key: string) => {
      saveProposalPatch('blocks', {
        content_blocks: proposal.content_blocks.filter(b => b.key !== key),
      });
    },
    [proposal.content_blocks, saveProposalPatch],
  );

  const moveBlock = useCallback(
    (key: string, dir: -1 | 1) => {
      const blocks = [...proposal.content_blocks];
      const index = blocks.findIndex(b => b.key === key);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= blocks.length) return;
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      saveProposalPatch('blocks', { content_blocks: blocks });
    },
    [proposal.content_blocks, saveProposalPatch],
  );

  const updateLineItem = useCallback(
    (itemId: string, patch: Partial<Omit<ProposalLineItem, 'id' | 'proposal_id' | 'created_at'>>) => {
      onLineItemsChange?.(lineItems.map(item => (item.id === itemId ? { ...item, ...patch } : item)));
      schedule(`line-${itemId}`, async () => {
        await updateProposalLineItem(itemId, patch);
      });
    },
    [lineItems, onLineItemsChange, schedule],
  );

  const addLineItem = useCallback(
    (fromCatalog?: ProposalTemplateLineItem) => {
      const nextOrder = lineItems.reduce((max, item) => Math.max(max, item.display_order), 0) + 10;
      const base = fromCatalog ?? {
        template_slug: null,
        name: 'New line item',
        description: '',
        content: '',
        one_time_price: null,
        one_time_label: null,
        monthly_price: null,
        monthly_label: null,
        image_url: null,
        display_order: nextOrder,
      };
      setSaveStatus('saving');
      createProposalLineItems([{ ...base, display_order: nextOrder, proposal_id: proposal.id }])
        .then(created => {
          onLineItemsChange?.([...lineItems, ...created]);
          setSaveStatus('saved');
          scheduleSavedToast(toast);
          window.setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2500);
        })
        .catch(() => {
          setSaveStatus('error');
          toast('Could not add line item');
        });
    },
    [lineItems, onLineItemsChange, proposal.id, toast],
  );

  const removeLineItem = useCallback(
    (itemId: string) => {
      onLineItemsChange?.(lineItems.filter(item => item.id !== itemId));
      schedule(`line-remove-${itemId}`, async () => {
        await deleteProposalLineItem(itemId);
      });
    },
    [lineItems, onLineItemsChange, schedule],
  );

  const moveLineItem = useCallback(
    (itemId: string, dir: -1 | 1) => {
      const sorted = [...lineItems].sort((a, b) => a.display_order - b.display_order);
      const index = sorted.findIndex(item => item.id === itemId);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= sorted.length) return;
      [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
      const reindexed = sorted.map((item, i) => ({ ...item, display_order: (i + 1) * 10 }));
      onLineItemsChange?.(reindexed);
      const changed = reindexed.filter(item => {
        const prev = lineItems.find(p => p.id === item.id);
        return prev && prev.display_order !== item.display_order;
      });
      schedule('line-reorder', async () => {
        await Promise.all(
          changed.map(item => updateProposalLineItem(item.id, { display_order: item.display_order })),
        );
      });
    },
    [lineItems, onLineItemsChange, schedule],
  );

  const updateDiscount = useCallback(
    (patch: {
      discount_type?: ProposalDiscountType;
      discount_value?: number;
      discount_applies_to?: ProposalDiscountAppliesTo;
      discount_label?: string | null;
    }) => {
      saveProposalPatch('discount', patch);
    },
    [saveProposalPatch],
  );

  const toggleContract = useCallback(
    (slug: string, included: boolean) => {
      const next = included
        ? [...new Set([...proposal.include_contracts, slug])]
        : proposal.include_contracts.filter(s => s !== slug);
      saveProposalPatch('contracts', { include_contracts: next });
    },
    [proposal.include_contracts, saveProposalPatch],
  );

  const value = useMemo<ProposalEditContextValue>(() => {
    if (mode !== 'edit') {
      return { mode, editMode: false, ...READ_ONLY_VALUE };
    }
    return {
      mode,
      editMode: true,
      saveStatus,
      updateTitle,
      updateBlock,
      addBlock,
      removeBlock,
      moveBlock,
      updateLineItem,
      addLineItem,
      removeLineItem,
      moveLineItem,
      updateDiscount,
      toggleContract,
    };
  }, [
    mode,
    saveStatus,
    updateTitle,
    updateBlock,
    addBlock,
    removeBlock,
    moveBlock,
    updateLineItem,
    addLineItem,
    removeLineItem,
    moveLineItem,
    updateDiscount,
    toggleContract,
  ]);

  return <ProposalEditContext.Provider value={value}>{children}</ProposalEditContext.Provider>;
}
