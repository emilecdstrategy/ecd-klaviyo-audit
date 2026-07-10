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
  listContractDocuments,
  updateProposal,
  updateProposalLineItem,
  updateProposalTemplate,
} from '../../../lib/proposals-db';
import type {
  Proposal,
  ProposalBlock,
  ProposalDiscountAppliesTo,
  ProposalDiscountType,
  ProposalLineItem,
  ProposalTemplate,
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

      // Once a proposal has been sent, contracts render from the frozen
      // contracts_snapshot rather than the live docs (see ProposalDocument).
      // While it is still unsigned, toggling a contract must also refresh
      // that snapshot — otherwise a newly-added contract has no content in
      // the snapshot and silently fails to render. Fetch the live docs first
      // so the optimistic update and the persisted row apply together.
      if (proposal.contracts_snapshot && !proposal.client_signed_at) {
        setSaveStatus('saving');
        listContractDocuments()
          .then(docs => {
            const snapshot = docs
              .filter(d => next.includes(d.slug))
              .map(d => ({ slug: d.slug, name: d.name, content: d.content, version_updated_at: d.updated_at }));
            onProposalChange?.({ ...proposal, include_contracts: next, contracts_snapshot: snapshot } as Proposal);
            return updateProposal(proposal.id, { include_contracts: next, contracts_snapshot: snapshot });
          })
          .then(() => {
            setSaveStatus('saved');
            scheduleSavedToast(toast);
            window.setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2500);
          })
          .catch(() => {
            setSaveStatus('error');
            toast('Could not save');
          });
        return;
      }

      saveProposalPatch('contracts', { include_contracts: next });
    },
    [proposal, onProposalChange, saveProposalPatch, toast],
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

// ---------------------------------------------------------------------------
// Template editing
//
// A proposal template stores the same editable surface as a proposal (text
// sections, line items, contracts, discount) but persists to a single
// proposal_templates row: line items live in a JSONB array rather than their
// own table, and there is no client, cover, signing, or contracts_snapshot.
// TemplateEditProvider exposes the identical ProposalEditContext so the shared
// editor components (ProposalRichBlock, ProposalPricingTable, DiscountEditor,
// contract toggles) work unchanged — only the persistence differs.

/** Client-side id for a template line item so the editor components, which key
 * line items by id, can track them. Stripped when persisted to the template. */
export function templateLineItemId(): string {
  return `tli_${Math.random().toString(36).slice(2, 9)}`;
}

function toTemplateLineItems(items: ProposalLineItem[]): ProposalTemplateLineItem[] {
  return [...items]
    .sort((a, b) => a.display_order - b.display_order)
    .map((item, index) => ({
      template_slug: item.template_slug,
      name: item.name,
      description: item.description,
      content: item.content,
      one_time_price: item.one_time_price,
      one_time_label: item.one_time_label,
      monthly_price: item.monthly_price,
      monthly_label: item.monthly_label,
      image_url: item.image_url,
      display_order: (index + 1) * 10,
    }));
}

type TemplateEditProviderProps = {
  mode: ProposalMode;
  template: ProposalTemplate;
  lineItems: ProposalLineItem[];
  onTemplateChange: (next: ProposalTemplate) => void;
  onLineItemsChange: (next: ProposalLineItem[]) => void;
  children: ReactNode;
};

export function TemplateEditProvider({
  mode,
  template,
  lineItems,
  onTemplateChange,
  onLineItemsChange,
  children,
}: TemplateEditProviderProps) {
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

  const saveTemplatePatch = useCallback(
    (key: string, patch: Parameters<typeof updateProposalTemplate>[1], next: ProposalTemplate) => {
      onTemplateChange(next);
      schedule(key, async () => {
        await updateProposalTemplate(template.id, patch);
      });
    },
    [onTemplateChange, schedule, template.id],
  );

  // Template line items persist as the whole JSONB array on every change.
  const saveLineItems = useCallback(
    (next: ProposalLineItem[]) => {
      onLineItemsChange(next);
      const payload = toTemplateLineItems(next);
      schedule('template-line-items', async () => {
        await updateProposalTemplate(template.id, { default_line_items: payload });
      });
    },
    [onLineItemsChange, schedule, template.id],
  );

  const updateTitle = useCallback(
    (value: string) => saveTemplatePatch('name', { name: value }, { ...template, name: value }),
    [saveTemplatePatch, template],
  );

  const updateBlock = useCallback(
    (key: string, patch: Partial<Omit<ProposalBlock, 'key'>>) => {
      const blocks = template.content_blocks.map(b => (b.key === key ? { ...b, ...patch } : b));
      saveTemplatePatch('blocks', { content_blocks: blocks }, { ...template, content_blocks: blocks });
    },
    [saveTemplatePatch, template],
  );

  const addBlock = useCallback(
    (afterKey: string | null) => {
      const blocks = [...template.content_blocks];
      const newBlock: ProposalBlock = { key: blockKey(), title: 'New section', content: '' };
      const index = afterKey ? blocks.findIndex(b => b.key === afterKey) : -1;
      if (index >= 0) blocks.splice(index + 1, 0, newBlock);
      else blocks.push(newBlock);
      saveTemplatePatch('blocks', { content_blocks: blocks }, { ...template, content_blocks: blocks });
    },
    [saveTemplatePatch, template],
  );

  const removeBlock = useCallback(
    (key: string) => {
      const blocks = template.content_blocks.filter(b => b.key !== key);
      saveTemplatePatch('blocks', { content_blocks: blocks }, { ...template, content_blocks: blocks });
    },
    [saveTemplatePatch, template],
  );

  const moveBlock = useCallback(
    (key: string, dir: -1 | 1) => {
      const blocks = [...template.content_blocks];
      const index = blocks.findIndex(b => b.key === key);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= blocks.length) return;
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      saveTemplatePatch('blocks', { content_blocks: blocks }, { ...template, content_blocks: blocks });
    },
    [saveTemplatePatch, template],
  );

  const updateLineItem = useCallback(
    (itemId: string, patch: Partial<Omit<ProposalLineItem, 'id' | 'proposal_id' | 'created_at'>>) => {
      saveLineItems(lineItems.map(item => (item.id === itemId ? { ...item, ...patch } : item)));
    },
    [lineItems, saveLineItems],
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
      const created: ProposalLineItem = {
        ...base,
        id: templateLineItemId(),
        proposal_id: '',
        created_at: '',
        display_order: nextOrder,
      };
      saveLineItems([...lineItems, created]);
    },
    [lineItems, saveLineItems],
  );

  const removeLineItem = useCallback(
    (itemId: string) => {
      saveLineItems(lineItems.filter(item => item.id !== itemId));
    },
    [lineItems, saveLineItems],
  );

  const moveLineItem = useCallback(
    (itemId: string, dir: -1 | 1) => {
      const sorted = [...lineItems].sort((a, b) => a.display_order - b.display_order);
      const index = sorted.findIndex(item => item.id === itemId);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= sorted.length) return;
      [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
      saveLineItems(sorted.map((item, i) => ({ ...item, display_order: (i + 1) * 10 })));
    },
    [lineItems, saveLineItems],
  );

  const updateDiscount = useCallback(
    (patch: {
      discount_type?: ProposalDiscountType;
      discount_value?: number;
      discount_applies_to?: ProposalDiscountAppliesTo;
      discount_label?: string | null;
    }) => {
      saveTemplatePatch('discount', patch, { ...template, ...patch });
    },
    [saveTemplatePatch, template],
  );

  const toggleContract = useCallback(
    (slug: string, included: boolean) => {
      const next = included
        ? [...new Set([...template.default_contracts, slug])]
        : template.default_contracts.filter(s => s !== slug);
      saveTemplatePatch('contracts', { default_contracts: next }, { ...template, default_contracts: next });
    },
    [saveTemplatePatch, template],
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
