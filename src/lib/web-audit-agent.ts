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

export type WebAuditAgentResponse = {
  ok?: boolean;
  assistant_text?: string;
  question?: WebAuditAgentQuestion;
  edits?: WebAuditEditSet;
  error?: { code?: string; message?: string };
};

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
