import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles } from 'lucide-react';
import {
  sendAuditContextMessage,
  type AuditContextDraft,
  type AuditContextQuestion,
  type AuditContextSnapshot,
} from '../../lib/audit-context-agent';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  question?: AuditContextQuestion;
  context?: AuditContextDraft;
  applied?: boolean;
};

const GREETING =
  "Hi! Paste the Fireflies link (or a Google Doc link) for the call and I'll pull the transcript, or just tell me about the client. Then I'll draft the background and the focus areas for this audit.";

function DraftPreview({ draft, applied, onApply }: { draft: AuditContextDraft; applied: boolean; onApply: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.04] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">Drafted context</p>
      <p className="mt-1 text-xs text-gray-600">{draft.summary}</p>
      {applied ? (
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Applied</div>
      ) : (
        <button type="button" onClick={onApply} className="mt-2 rounded-lg bg-brand-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark">
          Apply to context
        </button>
      )}
    </div>
  );
}

/** Always-open docked chat that gathers audit client context. Ephemeral (the
 * audit does not exist yet); nothing is persisted server-side. */
export default function AuditContextAssistant({
  getSnapshot,
  onApply,
  onTranscript,
}: {
  getSnapshot: () => AuditContextSnapshot;
  onApply: (draft: AuditContextDraft) => void;
  onTranscript?: (notes: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'greeting', role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastMsg = messages[messages.length - 1];
  const awaitingChoice = !sending && lastMsg?.role === 'assistant' && Boolean(lastMsg.question);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError('');
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', content: trimmed };
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);
    try {
      const history = nextMsgs.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
      const turn = await sendAuditContextMessage({ messages: history, snapshot: getSnapshot() });
      if (turn.fetched_notes && onTranscript) onTranscript(turn.fetched_notes);
      setMessages(prev => [
        ...prev,
        {
          id: `a${Date.now()}`,
          role: 'assistant',
          content: turn.assistant_text || turn.context?.summary || turn.question?.question || '',
          question: turn.question,
          context: turn.context,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant request failed.');
    } finally {
      setSending(false);
    }
  };

  const applyDraft = (msgId: string, draft: AuditContextDraft) => {
    onApply(draft);
    setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, applied: true } : m)));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-brand-primary" />
        <p className="flex-1 text-sm font-semibold text-gray-900">Context assistant</p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-primary px-3 py-1.5 text-sm text-white [overflow-wrap:anywhere]">{m.content}</div>
            ) : (
              <div className="max-w-[92%]">
                {m.content && <p className="text-sm leading-relaxed text-gray-700">{m.content}</p>}
                {m.question && awaitingChoice && lastMsg?.id === m.id && (
                  <div className="mt-2 space-y-1.5">
                    {m.question.options.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => void send(opt.value)}
                        className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                {m.context && <DraftPreview draft={m.context} applied={Boolean(m.applied)} onApply={() => applyDraft(m.id, m.context!)} />}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      </div>

      <form onSubmit={e => { e.preventDefault(); void send(input); }} className="flex items-end gap-2 border-t border-gray-100 p-2.5">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          rows={1}
          disabled={awaitingChoice}
          placeholder={awaitingChoice ? 'Pick an option above…' : 'Paste a link or type…'}
          className="max-h-28 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending || awaitingChoice}
          className="rounded-lg bg-brand-primary p-2 text-white hover:bg-brand-primary-dark disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
