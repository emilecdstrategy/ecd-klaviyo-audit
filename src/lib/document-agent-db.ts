import { supabase } from './supabase';
import { attachActorNames } from './actor-names';
import type { DocumentAgentConversation, DocumentAgentMessage } from './types';

export type DocumentAgentMessageWithAuthor = DocumentAgentMessage & { actor_name: string | null };

/** Latest active conversation for a document (or the latest document-less one when documentId is null). */
export async function getLatestDocConversation(
  documentId: string | null,
): Promise<DocumentAgentConversation | null> {
  let query = supabase
    .from('document_agent_conversations')
    .select('*')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1);
  query = documentId ? query.eq('document_id', documentId) : query.is('document_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as DocumentAgentConversation) ?? null;
}

export async function listDocConversations(documentId: string | null): Promise<DocumentAgentConversation[]> {
  let query = supabase.from('document_agent_conversations').select('*').order('updated_at', { ascending: false });
  query = documentId ? query.eq('document_id', documentId) : query.is('document_id', null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DocumentAgentConversation[];
}

export async function getDocConversationMessageCounts(conversationIds: string[]): Promise<Record<string, number>> {
  if (conversationIds.length === 0) return {};
  const { data, error } = await supabase
    .from('document_agent_messages')
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

export async function listDocConversationMessages(
  conversationId: string,
): Promise<DocumentAgentMessageWithAuthor[]> {
  const { data, error } = await supabase
    .from('document_agent_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return attachActorNames((data ?? []) as DocumentAgentMessage[]);
}

export async function markDocAgentMessageApplied(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('document_agent_messages')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export async function deleteDocConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.from('document_agent_conversations').delete().eq('id', conversationId);
  if (error) throw error;
}

export async function linkDocConversationToDocument(conversationId: string, documentId: string): Promise<void> {
  const { error } = await supabase
    .from('document_agent_conversations')
    .update({ document_id: documentId, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}
