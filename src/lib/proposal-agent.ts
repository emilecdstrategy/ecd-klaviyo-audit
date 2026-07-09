import { supabase } from './supabase';
import {
  createProposal,
  createProposalLineItems,
  deleteProposalLineItem,
  updateProposal,
  updateProposalLineItem,
} from './proposals-db';
import type {
  Proposal,
  ProposalBlock,
  ProposalDiscountAppliesTo,
  ProposalDiscountType,
  ProposalLineItem,
} from './types';

// ---------------------------------------------------------------------------
// Payload types (mirror supabase/functions/proposal_agent)

export type AgentQuestion = {
  question: string;
  options: Array<{ label: string; value: string }>;
  allow_other: boolean;
  multi_select?: boolean;
};

export type AgentDraftLineItem = {
  name: string;
  description: string;
  content: string;
  one_time_price: number | null;
  one_time_label: string | null;
  monthly_price: number | null;
  monthly_label: string | null;
};

export type AgentDiscount = {
  type: ProposalDiscountType;
  value: number;
  applies_to: ProposalDiscountAppliesTo;
  label: string | null;
};

export type ProposalDraftPayload = {
  title: string;
  client_id?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  content_blocks: Array<{ title: string; content: string }>;
  line_items: AgentDraftLineItem[];
  discount?: AgentDiscount;
  include_contracts?: string[];
  summary: string;
};

export type ProposalEditOp =
  | { op: 'update_title'; title: string }
  | { op: 'update_block'; block_key: string; title?: string; content?: string }
  | { op: 'add_block'; after_key?: string | null; title: string; content: string }
  | { op: 'remove_block'; block_key: string }
  | { op: 'add_line_item'; item: AgentDraftLineItem }
  | { op: 'update_line_item'; item_id: string; patch: Partial<AgentDraftLineItem> }
  | { op: 'delete_line_item'; item_id: string }
  | { op: 'update_discount'; discount: AgentDiscount }
  | { op: 'toggle_contract'; slug: string; included: boolean }
  | { op: 'update_recipient'; recipient_name?: string; recipient_email?: string };

export type ProposalEditSet = { summary: string; operations: ProposalEditOp[] };

export type AgentResponse = {
  ok: true;
  conversation_id: string;
  assistant_message_id: string;
  assistant_text: string;
  question?: AgentQuestion;
  draft?: ProposalDraftPayload;
  edits?: ProposalEditSet;
};

export type AgentSnapshot = {
  proposal: {
    id: string;
    title: string;
    status: string;
    content_blocks: ProposalBlock[];
    include_contracts: string[];
    discount_type: string;
    discount_value: number;
    discount_applies_to: string;
    discount_label: string | null;
    recipient_name: string;
    recipient_email: string;
    client_company_name?: string;
  };
  line_items: Array<
    Pick<
      ProposalLineItem,
      | 'id'
      | 'name'
      | 'description'
      | 'content'
      | 'one_time_price'
      | 'one_time_label'
      | 'monthly_price'
      | 'monthly_label'
      | 'display_order'
    >
  >;
};

export class ProposalAgentError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Thrown when the user dismisses the client picker instead of applying a draft. */
export class ApplyCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ApplyCancelled';
  }
}

// ---------------------------------------------------------------------------
// Copy sanitizing (belt and braces; the edge function sanitizes too)

export function sanitizeCopy(input: string): string {
  if (!input) return input;
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[–—]/g, ', ');
}

// ---------------------------------------------------------------------------
// Invoke

const BLOCK_CONTENT_SNAPSHOT_CAP = 2000;

export function buildSnapshot(proposal: Proposal, lineItems: ProposalLineItem[]): AgentSnapshot {
  return {
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      content_blocks: proposal.content_blocks.map(b => ({
        key: b.key,
        title: b.title,
        content:
          b.content.length > BLOCK_CONTENT_SNAPSHOT_CAP
            ? `${b.content.slice(0, BLOCK_CONTENT_SNAPSHOT_CAP)}\n[truncated]`
            : b.content,
      })),
      include_contracts: proposal.include_contracts,
      discount_type: proposal.discount_type,
      discount_value: proposal.discount_value,
      discount_applies_to: proposal.discount_applies_to,
      discount_label: proposal.discount_label,
      recipient_name: proposal.recipient_name,
      recipient_email: proposal.recipient_email,
      client_company_name: proposal.client?.company_name,
    },
    line_items: lineItems.map(li => ({
      id: li.id,
      name: li.name,
      description: li.description,
      content: li.content,
      one_time_price: li.one_time_price,
      one_time_label: li.one_time_label,
      monthly_price: li.monthly_price,
      monthly_label: li.monthly_label,
      display_order: li.display_order,
    })),
  };
}

export async function sendAgentMessage(input: {
  conversation_id?: string | null;
  proposal_id?: string | null;
  client_id?: string | null;
  message: string;
  snapshot?: AgentSnapshot | null;
}): Promise<AgentResponse> {
  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabase.functions.invoke<AgentResponse | { ok: false; error: { code: string; message: string } }>(
      'proposal_agent',
      {
        body: {
          conversation_id: input.conversation_id ?? undefined,
          proposal_id: input.proposal_id ?? undefined,
          client_id: input.client_id ?? undefined,
          message: input.message,
          snapshot: input.snapshot ?? undefined,
        },
      },
    );
    if (error) {
      lastErr = new ProposalAgentError(error.message || 'Request failed', 'request_failed');
      const retryable = /timeout|504|546|502|503|Failed to send/i.test(error.message ?? '');
      if (retryable && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1500 + attempt * 1000));
        continue;
      }
      throw lastErr;
    }
    if (!data || data.ok !== true) {
      const err = (data as { error?: { code?: string; message?: string } })?.error;
      throw new ProposalAgentError(err?.message ?? 'The assistant request failed', err?.code ?? 'request_failed');
    }
    return data;
  }
  throw lastErr instanceof Error ? lastErr : new ProposalAgentError('Request failed', 'request_failed');
}

// ---------------------------------------------------------------------------
// Apply helpers

function blockKey(): string {
  return `block_${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a brand-new proposal from an agent draft. Returns the created proposal. */
export async function applyDraftAsNewProposal(
  draft: ProposalDraftPayload,
  clientId: string,
): Promise<Proposal> {
  const proposal = await createProposal({
    client_id: clientId,
    title: sanitizeCopy(draft.title),
    content_blocks: draft.content_blocks.map(b => ({
      key: blockKey(),
      title: sanitizeCopy(b.title),
      content: sanitizeCopy(b.content),
    })),
    include_contracts: draft.include_contracts ?? [],
    recipient_name: draft.recipient_name ?? '',
    recipient_email: draft.recipient_email ?? '',
  });

  await createProposalLineItems(
    draft.line_items.map((item, i) => ({
      proposal_id: proposal.id,
      template_slug: null,
      name: sanitizeCopy(item.name),
      description: sanitizeCopy(item.description),
      content: sanitizeCopy(item.content),
      one_time_price: item.one_time_price,
      one_time_label: item.one_time_label ? sanitizeCopy(item.one_time_label) : null,
      monthly_price: item.monthly_price,
      monthly_label: item.monthly_label ? sanitizeCopy(item.monthly_label) : null,
      image_url: null,
      display_order: (i + 1) * 10,
    })),
  );

  if (draft.discount && draft.discount.type !== 'none') {
    await updateProposal(proposal.id, {
      discount_type: draft.discount.type,
      discount_value: draft.discount.value,
      discount_applies_to: draft.discount.applies_to,
      discount_label: draft.discount.label ? sanitizeCopy(draft.discount.label) : null,
    });
  }

  return proposal;
}

export type ApplyEditsResult = { proposal: Proposal; lineItems: ProposalLineItem[] };

/**
 * Apply an agent edit set against the current proposal state. Computes the
 * final content_blocks / discount / recipient state and writes it in one
 * updateProposal call, then performs line-item inserts/updates/deletes.
 * Returns fresh state for the host page to set.
 */
export async function applyEditSet(
  proposal: Proposal,
  lineItems: ProposalLineItem[],
  editSet: ProposalEditSet,
): Promise<ApplyEditsResult> {
  let blocks: ProposalBlock[] = proposal.content_blocks.map(b => ({ ...b }));
  let title = proposal.title;
  let includeContracts = [...proposal.include_contracts];
  let recipientName = proposal.recipient_name;
  let recipientEmail = proposal.recipient_email;
  let discount: AgentDiscount | null = null;
  let proposalDirty = false;

  let nextItems: ProposalLineItem[] = lineItems.map(li => ({ ...li }));
  const itemInserts: AgentDraftLineItem[] = [];
  const itemUpdates = new Map<string, Partial<AgentDraftLineItem>>();
  const itemDeletes = new Set<string>();

  for (const op of editSet.operations) {
    switch (op.op) {
      case 'update_title':
        title = sanitizeCopy(op.title);
        proposalDirty = true;
        break;
      case 'update_block':
        blocks = blocks.map(b =>
          b.key === op.block_key
            ? {
                ...b,
                ...(op.title != null ? { title: sanitizeCopy(op.title) } : {}),
                ...(op.content != null ? { content: sanitizeCopy(op.content) } : {}),
              }
            : b,
        );
        proposalDirty = true;
        break;
      case 'add_block': {
        const newBlock: ProposalBlock = {
          key: blockKey(),
          title: sanitizeCopy(op.title),
          content: sanitizeCopy(op.content),
        };
        const idx = op.after_key ? blocks.findIndex(b => b.key === op.after_key) : -1;
        if (idx >= 0) blocks.splice(idx + 1, 0, newBlock);
        else blocks.push(newBlock);
        proposalDirty = true;
        break;
      }
      case 'remove_block':
        blocks = blocks.filter(b => b.key !== op.block_key);
        proposalDirty = true;
        break;
      case 'add_line_item':
        itemInserts.push(op.item);
        break;
      case 'update_line_item': {
        const existing = itemUpdates.get(op.item_id) ?? {};
        itemUpdates.set(op.item_id, { ...existing, ...op.patch });
        break;
      }
      case 'delete_line_item':
        itemDeletes.add(op.item_id);
        break;
      case 'update_discount':
        discount = op.discount;
        proposalDirty = true;
        break;
      case 'toggle_contract':
        includeContracts = op.included
          ? [...new Set([...includeContracts, op.slug])]
          : includeContracts.filter(s => s !== op.slug);
        proposalDirty = true;
        break;
      case 'update_recipient':
        if (op.recipient_name != null) recipientName = op.recipient_name;
        if (op.recipient_email != null) recipientEmail = op.recipient_email;
        proposalDirty = true;
        break;
    }
  }

  let nextProposal = proposal;
  if (proposalDirty) {
    nextProposal = await updateProposal(proposal.id, {
      title,
      content_blocks: blocks,
      include_contracts: includeContracts,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      ...(discount
        ? {
            discount_type: discount.type,
            discount_value: discount.value,
            discount_applies_to: discount.applies_to,
            discount_label: discount.label ? sanitizeCopy(discount.label) : null,
          }
        : {}),
    });
  }

  for (const [itemId, patch] of itemUpdates) {
    if (itemDeletes.has(itemId)) continue;
    const clean: Record<string, unknown> = {};
    if (patch.name != null) clean.name = sanitizeCopy(patch.name);
    if (patch.description != null) clean.description = sanitizeCopy(patch.description);
    if (patch.content != null) clean.content = sanitizeCopy(patch.content);
    if ('one_time_price' in patch) clean.one_time_price = patch.one_time_price;
    if ('monthly_price' in patch) clean.monthly_price = patch.monthly_price;
    if ('one_time_label' in patch) {
      clean.one_time_label = patch.one_time_label ? sanitizeCopy(patch.one_time_label) : null;
    }
    if ('monthly_label' in patch) {
      clean.monthly_label = patch.monthly_label ? sanitizeCopy(patch.monthly_label) : null;
    }
    if (Object.keys(clean).length === 0) continue;
    const updated = await updateProposalLineItem(itemId, clean);
    nextItems = nextItems.map(li => (li.id === itemId ? updated : li));
  }

  for (const itemId of itemDeletes) {
    await deleteProposalLineItem(itemId);
    nextItems = nextItems.filter(li => li.id !== itemId);
  }

  if (itemInserts.length > 0) {
    const maxOrder = nextItems.reduce((max, li) => Math.max(max, li.display_order), 0);
    const created = await createProposalLineItems(
      itemInserts.map((item, i) => ({
        proposal_id: proposal.id,
        template_slug: null,
        name: sanitizeCopy(item.name),
        description: sanitizeCopy(item.description),
        content: sanitizeCopy(item.content),
        one_time_price: item.one_time_price,
        one_time_label: item.one_time_label ? sanitizeCopy(item.one_time_label) : null,
        monthly_price: item.monthly_price,
        monthly_label: item.monthly_label ? sanitizeCopy(item.monthly_label) : null,
        image_url: null,
        display_order: maxOrder + (i + 1) * 10,
      })),
    );
    nextItems = [...nextItems, ...created];
  }

  return { proposal: nextProposal, lineItems: nextItems };
}
