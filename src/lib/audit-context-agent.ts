import { supabase } from './supabase';

export type AuditContextSnapshot = {
  client_name?: string;
  company_name?: string;
  website_url?: string;
  audit_type?: string;
  meeting_notes?: string;
  client_background?: string;
  custom_instructions?: string;
  sells_subscriptions?: boolean;
};

export type AuditContextQuestion = {
  question: string;
  options: Array<{ label: string; value: string }>;
  multi_select?: boolean;
};

export type AuditContextDraft = {
  client_background: string;
  custom_instructions: string;
  sells_subscriptions: boolean;
  summary: string;
};

export type AuditContextTurn = {
  assistant_text: string;
  question?: AuditContextQuestion;
  context?: AuditContextDraft;
  /** Raw transcript the assistant fetched this turn (persisted to the audit). */
  fetched_notes?: string;
};

export async function sendAuditContextMessage(input: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  snapshot: AuditContextSnapshot;
}): Promise<AuditContextTurn> {
  const { data, error } = await supabase.functions.invoke('audit_context_agent', {
    body: { messages: input.messages, snapshot: input.snapshot },
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
  if (data?.ok !== true) throw new Error(data?.error?.message ?? 'The assistant request failed');
  return {
    assistant_text: data.assistant_text ?? '',
    question: data.question,
    context: data.context,
    fetched_notes: data.fetched_notes,
  };
}
