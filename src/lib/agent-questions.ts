// Shapes and helpers for ask_user payloads (supabase/functions/_shared/ask-user.ts).

export type AgentQuestionItem = {
  question: string;
  options: Array<{ label: string; value: string }>;
  multi_select?: boolean;
};

/** An ask_user payload. The first question is always at the top level; `questions`
 * is set when the assistant asked several at once. */
export type AgentQuestionPayload = AgentQuestionItem & {
  allow_other?: boolean;
  questions?: AgentQuestionItem[];
};

export function questionItems(payload: AgentQuestionPayload): AgentQuestionItem[] {
  return payload.questions && payload.questions.length > 1 ? payload.questions : [payload];
}

/** The text sent back for a multi-question ask: each question with its answer,
 * numbered in the order asked, so the assistant can take them point by point. */
export function formatAnswers(items: AgentQuestionItem[], answers: string[]): string {
  return items.map((q, i) => `${i + 1}. ${q.question}\n${answers[i]}`).join('\n\n');
}
