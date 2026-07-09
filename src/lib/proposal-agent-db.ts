import { supabase } from './supabase';
import type { ProposalAgentConversation, ProposalAgentMessage } from './types';

/** Latest active conversation for a proposal (or the latest proposal-less one when proposalId is null). */
export async function getLatestConversation(
  proposalId: string | null,
): Promise<ProposalAgentConversation | null> {
  let query = supabase
    .from('proposal_agent_conversations')
    .select('*')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1);
  query = proposalId ? query.eq('proposal_id', proposalId) : query.is('proposal_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as ProposalAgentConversation) ?? null;
}

/** All conversations for a proposal (or proposal-less chats when proposalId is null), newest first. */
export async function listConversations(
  proposalId: string | null,
): Promise<ProposalAgentConversation[]> {
  let query = supabase
    .from('proposal_agent_conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  query = proposalId ? query.eq('proposal_id', proposalId) : query.is('proposal_id', null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProposalAgentConversation[];
}

/** Message count per conversation, for the history list. */
export async function getConversationMessageCounts(
  conversationIds: string[],
): Promise<Record<string, number>> {
  if (conversationIds.length === 0) return {};
  const { data, error } = await supabase
    .from('proposal_agent_messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .neq('role', 'tool');
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { conversation_id: string }[]) {
    counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
  }
  return counts;
}

export async function listConversationMessages(
  conversationId: string,
): Promise<ProposalAgentMessage[]> {
  const { data, error } = await supabase
    .from('proposal_agent_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProposalAgentMessage[];
}

/** Link a proposal-less conversation to the proposal created from its draft. */
export async function linkConversationToProposal(
  conversationId: string,
  proposalId: string,
): Promise<void> {
  const { error } = await supabase
    .from('proposal_agent_conversations')
    .update({ proposal_id: proposalId, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

export async function markAgentMessageApplied(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('proposal_agent_messages')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

/** Archive the active conversation so the next message starts a fresh chat. */
export async function archiveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('proposal_agent_conversations')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}
