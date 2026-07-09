import { supabase } from './supabase';
import { attachActorNames } from './actor-names';
import { publicProposalOrigin } from './public-origin';
import type {
  ContractDocument,
  Proposal,
  ProposalEvent,
  ProposalEventType,
  ProposalLineItem,
  ProposalSettings,
  ProposalSignature,
  ProposalTemplate,
} from './types';

export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = {
  cover: {
    background_url: null,
    logo_url: null,
    tagline: 'Lifecycle marketing that compounds.',
  },
  email: {
    from_name: 'ECD Digital Strategy',
    from_email: null,
    reply_to: null,
    team_notification_emails: [],
  },
  defaults: {
    valid_days: 30,
  },
};

export function mergeProposalSettings(raw: unknown): ProposalSettings {
  const value = (raw ?? {}) as Partial<ProposalSettings>;
  return {
    cover: { ...DEFAULT_PROPOSAL_SETTINGS.cover, ...(value.cover ?? {}) },
    email: { ...DEFAULT_PROPOSAL_SETTINGS.email, ...(value.email ?? {}) },
    defaults: { ...DEFAULT_PROPOSAL_SETTINGS.defaults, ...(value.defaults ?? {}) },
  };
}

export async function getProposalSettings(): Promise<ProposalSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('proposal_settings')
    .eq('id', 'default')
    .maybeSingle();
  if (error || !data) return DEFAULT_PROPOSAL_SETTINGS;
  return mergeProposalSettings(data.proposal_settings);
}

export async function updateProposalSettings(settings: ProposalSettings): Promise<void> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ proposal_settings: settings, updated_at: new Date().toISOString() })
    .eq('id', 'default');
  if (error) throw error;
}

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

export async function listProposalsByClient(clientId: string): Promise<Proposal[]> {
  const { data, error } = await supabase
    .from('proposals')
    .select(PROPOSAL_LIST_SELECT)
    .eq('client_id', clientId)
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

export async function createProposal(
  input: CreateProposalInput,
  options: { aiAssisted?: boolean } = {},
): Promise<Proposal> {
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
  await recordProposalEvent(proposal.id, 'created', options.aiAssisted ? { via: 'ai_assistant' } : {});
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
// Sending / public link

function generatePublicToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ensure a proposal is shareable: generates the public token, freezes the
 * contract snapshot, sets valid_until, and flips draft -> sent. Refreshes the
 * contract snapshot on every call while the proposal is unsigned so contract
 * edits reach clients who have not signed yet.
 */
export async function markProposalSent(proposal: Proposal): Promise<Proposal> {
  if (proposal.client_signed_at) return proposal;

  const [settings, contractDocs] = await Promise.all([
    getProposalSettings(),
    listContractDocuments(),
  ]);

  const snapshot = contractDocs
    .filter(doc => proposal.include_contracts.includes(doc.slug))
    .map(doc => ({
      slug: doc.slug,
      name: doc.name,
      content: doc.content,
      version_updated_at: doc.updated_at,
    }));

  const validDays = settings.defaults.valid_days || 30;
  const validUntil =
    proposal.valid_until ??
    new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const wasDraft = proposal.status === 'draft';
  const updates: Record<string, unknown> = {
    public_token: proposal.public_token ?? generatePublicToken(),
    contracts_snapshot: snapshot,
    valid_until: validUntil,
    updated_at: new Date().toISOString(),
  };
  if (wasDraft) {
    updates.status = 'sent';
    updates.sent_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('proposals')
    .update(updates)
    .eq('id', proposal.id)
    .select(PROPOSAL_LIST_SELECT)
    .single();
  if (error) throw error;

  if (wasDraft) {
    await recordProposalEvent(proposal.id, 'sent', { via: 'link' });
  }
  return mapProposalRow(data);
}

/** Extend (or shorten) the valid-until date; un-expires a proposal. */
export async function extendProposalValidity(id: string, validUntil: string): Promise<Proposal> {
  return updateProposal(id, { valid_until: validUntil });
}

// ---------------------------------------------------------------------------
// Public page + signing (edge functions; no session required for the first two)

export type PublicProposalPayload = {
  proposal: Pick<
    Proposal,
    | 'proposal_number'
    | 'title'
    | 'status'
    | 'cover'
    | 'content_blocks'
    | 'include_contracts'
    | 'contracts_snapshot'
    | 'discount_type'
    | 'discount_value'
    | 'discount_applies_to'
    | 'discount_label'
    | 'recipient_name'
    | 'recipient_email'
    | 'valid_until'
    | 'sent_at'
    | 'created_at'
    | 'client_signed_at'
    | 'countersigned_at'
  >;
  client: { company_name: string; website_url: string | null };
  line_items: ProposalLineItem[];
  signatures: Pick<ProposalSignature, 'role' | 'signer_name' | 'signature_image' | 'signed_at'>[];
  expired: boolean;
  settings: { cover: Partial<ProposalSettings['cover']> };
};

export async function fetchPublicProposal(
  token: string,
  options: { preview?: boolean } = {},
): Promise<PublicProposalPayload | null> {
  const { data, error } = await supabase.functions.invoke('proposal_public', {
    body: { token, preview: options.preview ?? false },
  });
  if (error) {
    // FunctionsHttpError with 404 means unknown token/draft — treat as not found.
    return null;
  }
  if (data?.ok !== true) return null;
  return data as PublicProposalPayload;
}

export async function signProposalPublic(input: {
  token: string;
  typed_name: string;
  signer_email: string;
  signature_image: string;
}): Promise<{ ok: boolean; code?: string; message?: string }> {
  const { data, error } = await supabase.functions.invoke('proposal_sign', { body: input });
  if (error) {
    // Supabase wraps non-2xx responses; surface the coded errors we return.
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.json();
        return { ok: false, code: body?.error?.code, message: body?.error?.message };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, message: error.message };
  }
  if (data?.ok !== true) {
    return { ok: false, code: data?.error?.code, message: data?.error?.message };
  }
  return { ok: true };
}

export async function countersignProposal(input: {
  proposal_id: string;
  typed_name: string;
  signature_image: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('proposal_countersign', { body: input });
  if (error) throw error;
  if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to countersign');
}

export async function sendProposalEmail(input: {
  proposal_id: string;
  recipient_email: string;
  recipient_name?: string;
  message?: string;
  reply_to_emails?: string[];
}): Promise<{ public_token: string; email_status: 'sent' | 'skipped' }> {
  const { data, error } = await supabase.functions.invoke('proposal_send_email', {
    body: { ...input, app_url: publicProposalOrigin() },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.json();
        throw new Error(body?.error?.message ?? error.message);
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e;
      }
    }
    throw error;
  }
  if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Failed to send proposal');
  return { public_token: data.public_token, email_status: data.email_status };
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
  return attachActorNames((data ?? []) as ProposalEvent[]);
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
