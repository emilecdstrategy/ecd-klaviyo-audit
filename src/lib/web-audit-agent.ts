import { supabase } from './supabase';
import type { WebFinding } from './web-report-details';

export type WebAuditAgentQuestion = { question: string; options: string[] };

export type WebAuditEditOp =
  | { op: 'add_finding'; text: string; recommendation?: string; viewport?: 'desktop' | 'mobile' | 'both' }
  | { op: 'update_finding'; index: number; text?: string; recommendation?: string; viewport?: 'desktop' | 'mobile' | 'both' }
  | { op: 'remove_finding'; index: number };

export type WebAuditEditSet = {
  section_key: string;
  section_title: string;
  summary: string;
  section_summary?: string;
  operations: WebAuditEditOp[];
};

export type WebAuditRegenerate = {
  section_key: string;
  section_title: string;
  instruction?: string;
  summary: string;
};

export type WebAuditAgentResponse = {
  ok?: boolean;
  assistant_text?: string;
  question?: WebAuditAgentQuestion;
  edits?: WebAuditEditSet;
  regenerate?: WebAuditRegenerate;
  error?: { code?: string; message?: string };
};

// --- Persisted chat history (one thread per audit) -------------------------

export type WebAuditAgentMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  payload: { question?: WebAuditAgentQuestion; edits?: WebAuditEditSet; regenerate?: WebAuditRegenerate } | null;
  applied: boolean;
};

export async function listWebAuditAgentMessages(auditId: string): Promise<WebAuditAgentMessageRow[]> {
  const { data, error } = await supabase
    .from('web_audit_agent_messages')
    .select('id, role, content, payload, applied')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WebAuditAgentMessageRow[];
}

export async function insertWebAuditAgentMessage(input: {
  auditId: string;
  role: 'user' | 'assistant';
  content: string;
  payload?: WebAuditAgentMessageRow['payload'];
}): Promise<string> {
  const { data, error } = await supabase
    .from('web_audit_agent_messages')
    .insert({ audit_id: input.auditId, role: input.role, content: input.content, payload: input.payload ?? null })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function markWebAuditAgentMessageApplied(id: string): Promise<void> {
  await supabase.from('web_audit_agent_messages').update({ applied: true }).eq('id', id);
}

/** Send one message to the web-audit assistant. */
export async function sendWebAuditAgentMessage(input: {
  auditId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<WebAuditAgentResponse> {
  const { data, error } = await supabase.functions.invoke<WebAuditAgentResponse>('web_audit_agent', {
    body: { audit_id: input.auditId, message: input.message, history: input.history },
  });
  if (error) throw new Error(error.message || 'The assistant request failed.');
  if (!data?.ok) throw new Error(data?.error?.message || 'The assistant could not complete that request.');
  return data;
}

/** Regenerate a whole section's findings server-side (a fresh AI pass over the
 * page screenshots), optionally steered by an instruction. Runs synchronously. */
export async function regenerateWebSection(auditId: string, sectionKey: string, instruction?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: { message?: string } }>('web_finalize_analysis', {
    body: { audit_id: auditId, mode: 'regenerate_section', section_key: sectionKey, instruction },
  });
  if (error) throw new Error(error.message || 'Section regeneration failed');
  if (!data?.ok) throw new Error(data?.error?.message || 'Section regeneration failed');
}

/** Apply an edit set's operations to a section's current findings, returning the
 * next findings array. Index-based ops refer to the original list, so updates are
 * applied first, then removals, then additions are appended. */
export function applyEditsToFindings(current: WebFinding[], ops: WebAuditEditOp[]): WebFinding[] {
  const next: (WebFinding | null)[] = current.map((f) => ({ ...f }));
  for (const op of ops) {
    if (op.op === 'update_finding' && next[op.index]) {
      const f = next[op.index] as WebFinding;
      if (op.text != null) f.text = op.text;
      if (op.recommendation != null) f.recommendation = op.recommendation;
      if (op.viewport != null) f.viewport = op.viewport;
    } else if (op.op === 'remove_finding') {
      if (op.index >= 0 && op.index < next.length) next[op.index] = null;
    }
  }
  const result = next.filter((f): f is WebFinding => f !== null);
  for (const op of ops) {
    if (op.op === 'add_finding') {
      result.push({
        text: op.text,
        recommendation: op.recommendation ?? '',
        viewport: op.viewport ?? 'both',
        highlight: null,
        hidden: false,
      });
    }
  }
  return result;
}

/** Short human-readable description of an operation, for the preview card. */
export function describeEditOp(op: WebAuditEditOp): string {
  if (op.op === 'add_finding') return `Add finding (${op.viewport ?? 'both'}): ${op.text}`;
  if (op.op === 'remove_finding') return `Remove finding #${op.index + 1}`;
  const parts: string[] = [];
  if (op.text != null) parts.push('problem');
  if (op.recommendation != null) parts.push('fix');
  if (op.viewport != null) parts.push('device');
  return `Update finding #${op.index + 1}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}
