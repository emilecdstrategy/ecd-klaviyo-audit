import { supabase } from './supabase';
import type {
  ContractDocument,
  Proposal,
  ProposalEvent,
  ProposalEventType,
  ProposalLineItem,
  ProposalSignature,
  ProposalTemplate,
} from './types';

const PROPOSAL_LIST_SELECT = '*, client:clients(*), line_items:proposal_line_items(*)';

function mapProposalRow(row: Record<string, unknown>): Proposal {
  return {
    ...(row as unknown as Proposal),
    cover: (row.cover as Proposal['cover']) ?? {},
    content_blocks: Array.isArray(row.content_blocks) ? (row.content_blocks as Proposal['content_blocks']) : [],
    include_contracts: Array.isArray(row.include_contracts) ? (row.include_contracts as string[]) : [],
    contracts_snapshot: Array.isArray(row.contracts_snapshot)
      ? (row.contracts_snapshot as Proposal['contracts_snapshot'])
      : null,
    discount_value: Number(row.discount_value ?? 0),
    line_items: Array.isArray(row.line_items)
      ? (row.line_items as Record<string, unknown>[])
          .map(mapLineItemRow)
          .sort((a, b) => a.display_order - b.display_order)
      : undefined,
  };
}

function mapLineItemRow(row: Record<string, unknown>): ProposalLineItem {
  return {
    ...(row as unknown as ProposalLineItem),
    one_time_price: row.one_time_price != null ? Number(row.one_time_price) : null,
    monthly_price: row.monthly_price != null ? Number(row.monthly_price) : null,
  };
}

// ---------------------------------------------------------------------------
// Proposals

export async function listProposals(): Promise<Proposal[]> {
  const { data, error } = await supabase
    .from('proposals')
    .select(PROPOSAL_LIST_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapProposalRow);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { data, error } = await supabase
    .from('proposals')
    .select(PROPOSAL_LIST_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProposalRow(data) : null;
}

export type CreateProposalInput = {
  client_id: string;
  audit_id?: string | null;
  template_id?: string | null;
  title: string;
  content_blocks?: Proposal['content_blocks'];
  include_contracts?: string[];
  recipient_name?: string;
  recipient_email?: string;
};

export async function createProposal(input: CreateProposalInput): Promise<Proposal> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      client_id: input.client_id,
      audit_id: input.audit_id ?? null,
      template_id: input.template_id ?? null,
      title: input.title,
      content_blocks: input.content_blocks ?? [],
      include_contracts: input.include_contracts ?? [],
      recipient_name: input.recipient_name ?? '',
      recipient_email: input.recipient_email ?? '',
      created_by: userId,
    })
    .select(PROPOSAL_LIST_SELECT)
    .single();
  if (error) throw error;
  const proposal = mapProposalRow(data);
  await recordProposalEvent(proposal.id, 'created');
  return proposal;
}

export async function updateProposal(
  id: string,
  updates: Partial<
    Pick<
      Proposal,
      | 'title'
      | 'cover'
      | 'content_blocks'
      | 'include_contracts'
      | 'discount_type'
      | 'discount_value'
      | 'discount_applies_to'
      | 'discount_label'
      | 'recipient_name'
      | 'recipient_email'
      | 'valid_until'
      | 'status'
      | 'lost_at'
      | 'lost_reason'
      | 'won_at'
    >
  >,
): Promise<Proposal> {
  const { data, error } = await supabase
    .from('proposals')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(PROPOSAL_LIST_SELECT)
    .single();
  if (error) throw error;
  return mapProposalRow(data);
}

export async function deleteProposal(id: string): Promise<void> {
  const { error } = await supabase.from('proposals').delete().eq('id', id);
  if (error) throw error;
}

export async function markProposalLost(id: string, reason: string | null): Promise<Proposal> {
  const proposal = await updateProposal(id, {
    status: 'lost',
    lost_at: new Date().toISOString(),
    lost_reason: reason,
  });
  await recordProposalEvent(id, 'lost', reason ? { reason } : {});
  return proposal;
}

export async function markProposalWon(id: string): Promise<Proposal> {
  const proposal = await updateProposal(id, {
    status: 'won',
    won_at: new Date().toISOString(),
  });
  await recordProposalEvent(id, 'won', { manual: true });
  return proposal;
}

export async function reopenProposal(id: string): Promise<Proposal> {
  const proposal = await updateProposal(id, {
    status: 'sent',
    lost_at: null,
    lost_reason: null,
  });
  await recordProposalEvent(id, 'reopened');
  return proposal;
}

// ---------------------------------------------------------------------------
// Line items

export async function listProposalLineItems(proposalId: string): Promise<ProposalLineItem[]> {
  const { data, error } = await supabase
    .from('proposal_line_items')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapLineItemRow);
}

export type CreateProposalLineItemInput = Omit<ProposalLineItem, 'id' | 'created_at'>;

export async function createProposalLineItems(
  items: CreateProposalLineItemInput[],
): Promise<ProposalLineItem[]> {
  if (items.length === 0) return [];
  const { data, error } = await supabase
    .from('proposal_line_items')
    .insert(items)
    .select('*');
  if (error) throw error;
  return (data ?? []).map(mapLineItemRow);
}

export async function updateProposalLineItem(
  id: string,
  updates: Partial<Omit<ProposalLineItem, 'id' | 'proposal_id' | 'created_at'>>,
): Promise<ProposalLineItem> {
  const { data, error } = await supabase
    .from('proposal_line_items')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return mapLineItemRow(data);
}

export async function deleteProposalLineItem(id: string): Promise<void> {
  const { error } = await supabase.from('proposal_line_items').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Events & signatures

export async function listProposalEvents(proposalId: string): Promise<ProposalEvent[]> {
  const { data, error } = await supabase
    .from('proposal_events')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProposalEvent[];
}

export async function recordProposalEvent(
  proposalId: string,
  eventType: ProposalEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return;
  const { error } = await supabase.from('proposal_events').insert({
    proposal_id: proposalId,
    event_type: eventType,
    actor: 'admin',
    actor_user_id: userId,
    metadata,
  });
  if (error) throw error;
}

export async function listProposalSignatures(proposalId: string): Promise<ProposalSignature[]> {
  const { data, error } = await supabase
    .from('proposal_signatures')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('signed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProposalSignature[];
}

// ---------------------------------------------------------------------------
// Templates

export async function listProposalTemplates(
  options: { activeOnly?: boolean } = {},
): Promise<ProposalTemplate[]> {
  let query = supabase
    .from('proposal_templates')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });
  if (options.activeOnly) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProposalTemplate[];
}

export async function createProposalTemplate(
  input: Omit<ProposalTemplate, 'id' | 'created_at' | 'updated_at'>,
): Promise<ProposalTemplate> {
  const { data, error } = await supabase
    .from('proposal_templates')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ProposalTemplate;
}

export async function updateProposalTemplate(
  id: string,
  updates: Partial<Omit<ProposalTemplate, 'id' | 'created_at' | 'updated_at'>>,
): Promise<ProposalTemplate> {
  const { data, error } = await supabase
    .from('proposal_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ProposalTemplate;
}

export async function deleteProposalTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('proposal_templates').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Contract documents

export async function listContractDocuments(): Promise<ContractDocument[]> {
  const { data, error } = await supabase
    .from('contract_documents')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ContractDocument[];
}

export async function updateContractDocument(
  id: string,
  updates: Partial<Pick<ContractDocument, 'name' | 'content' | 'is_active'>>,
): Promise<ContractDocument> {
  const { data, error } = await supabase
    .from('contract_documents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ContractDocument;
}
