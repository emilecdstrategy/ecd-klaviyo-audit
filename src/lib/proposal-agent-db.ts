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

export type ProposalAgentMessageWithAuthor = ProposalAgentMessage & { actor_name: string | null };

export async function listConversationMessages(
  conversationId: string,
): Promise<ProposalAgentMessageWithAuthor[]> {
  const { data, error } = await supabase
    .from('proposal_agent_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return attachAgentMessageAuthors((data ?? []) as ProposalAgentMessage[]);
}

/** Resolves actor_user_id on chat message rows to display names, one query per batch. */
export async function attachAgentMessageAuthors(
  messages: ProposalAgentMessage[],
): Promise<ProposalAgentMessageWithAuthor[]> {
  const ids = [...new Set(messages.map(m => m.actor_user_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return messages.map(m => ({ ...m, actor_name: null }));
  const { data, error } = await supabase.from('profiles').select('id, name').in('id', ids);
  if (error) throw error;
  const nameById = new Map((data ?? []).map(p => [p.id as string, p.name as string]));
  return messages.map(m => ({ ...m, actor_name: m.actor_user_id ? nameById.get(m.actor_user_id) ?? null : null }));
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

/** Permanently delete a conversation and its messages (messages cascade). */
export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('proposal_agent_conversations')
    .delete()
    .eq('id', conversationId);
  if (error) throw error;
}
