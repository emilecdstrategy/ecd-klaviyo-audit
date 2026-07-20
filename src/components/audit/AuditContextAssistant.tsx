import { useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles, Wand2 } from 'lucide-react';
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

function DraftPreview({ draft, applied, onApply }: { draft: AuditContextDraft; applied: boolean; onApply: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">Drafted context</p>
      <p className="mt-1 text-xs text-gray-500">{draft.summary}</p>
      <button type="button" onClick={() => setOpen(v => !v)} className="mt-1.5 text-xs font-medium text-brand-primary hover:underline">
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-gray-700">
          <div>
            <p className="font-semibold text-gray-800">Client background</p>
            <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{draft.client_background || '—'}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Focus areas</p>
            <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{draft.custom_instructions || '—'}</p>
          </div>
          <p className="text-gray-500">Sells subscriptions: <span className="font-medium text-gray-700">{draft.sells_subscriptions ? 'Yes' : 'No'}</span></p>
        </div>
      )}
      {applied ? (
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Applied to the form</div>
      ) : (
        <button type="button" onClick={onApply} className="mt-2 rounded-lg bg-brand-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark">
          Apply to context
        </button>
      )}
    </div>
  );
}

/** Inline chat assistant that drafts the audit's client context from the pasted
 * transcript. Ephemeral (the audit does not exist yet); nothing is persisted. */
export default function AuditContextAssistant({
  getSnapshot,
  onApply,
}: {
  getSnapshot: () => AuditContextSnapshot;
  onApply: (draft: AuditContextDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastMsg = messages[messages.length - 1];
  const awaitingChoice = !sending && lastMsg?.role === 'assistant' && Boolean(lastMsg.question);

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
      const history = nextMsgs.map(m => ({ role: m.role, content: m.content }));
      const turn = await sendAuditContextMessage({ messages: history, snapshot: getSnapshot() });
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
      window.requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); if (messages.length === 0) void send('Draft the client context from the transcript and notes.'); }}
        className="flex w-full items-center gap-3 rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-left hover:bg-brand-primary/10"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full gradient-bg text-white"><Wand2 className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-900">Draft context with AI</span>
          <span className="block text-xs text-gray-500">Turn the transcript into client background and audit focus areas.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-brand-primary" />
        <p className="flex-1 text-sm font-semibold text-gray-900">Context assistant</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-gray-400 hover:text-gray-600">Hide</button>
      </div>

      <div ref={scrollRef} className="max-h-80 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-primary px-3 py-1.5 text-sm text-white">{m.content}</div>
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

      <form
        onSubmit={e => { e.preventDefault(); void send(input); }}
        className="flex items-end gap-2 border-t border-gray-100 p-2.5"
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          rows={1}
          disabled={awaitingChoice}
          placeholder={awaitingChoice ? 'Pick an option above…' : 'Ask or tell the assistant something…'}
          className="max-h-24 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none disabled:bg-gray-50"
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
