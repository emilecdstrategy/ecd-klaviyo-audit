import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, Send, Sparkles } from 'lucide-react';
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
  onFirstInteraction,
}: {
  getSnapshot: () => AuditContextSnapshot;
  onApply: (draft: AuditContextDraft) => void;
  onTranscript?: (notes: string) => void;
  /** Fired once, the first time the strategist engages with the chat (focus or send). */
  onFirstInteraction?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'greeting', role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const dictationBaseRef = useRef('');
  const interactedRef = useRef(false);

  const markInteracted = () => {
    if (interactedRef.current) return;
    interactedRef.current = true;
    onFirstInteraction?.();
  };

  const lastMsg = messages[messages.length - 1];
  const awaitingChoice = !sending && lastMsg?.role === 'assistant' && Boolean(lastMsg.question);
  const voiceSupported =
    typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const stopDictation = () => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    setListening(false);
  };

  // Stop any in-progress dictation when the component unmounts.
  useEffect(() => () => stopDictation(), []);

  const toggleDictation = () => {
    if (listening) { stopDictation(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    dictationBaseRef.current = input.trim() ? `${input.trim()} ` : '';
    rec.onresult = (e: any) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setInput(dictationBaseRef.current + transcript);
    };
    rec.onend = () => { recognitionRef.current = null; setListening(false); };
    rec.onerror = () => { recognitionRef.current = null; setListening(false); };
    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    markInteracted();
    if (listening) stopDictation();
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
      // Include the question text in the stored content so it is replayed to the
      // model next turn; otherwise the model loses what a chip answer referred to
      // and re-asks the same question.
      let content = turn.assistant_text || '';
      if (turn.question?.question) {
        content = content ? `${content}\n\n${turn.question.question}` : turn.question.question;
      } else if (!content && turn.context?.summary) {
        content = turn.context.summary;
      }
      setMessages(prev => [
        ...prev,
        {
          id: `a${Date.now()}`,
          role: 'assistant',
          content,
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
                    {m.question.options.map(opt => {
                      // An "Other"/"something else" chip shouldn't submit the literal
                      // word; focus the composer so the strategist types their answer.
                      const isOther = /^(other|others|something else|none( of (the above|these))?|custom|not sure)\b/i.test(
                        `${opt.label} ${opt.value}`.trim(),
                      );
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { if (isOther) { inputRef.current?.focus(); return; } void send(opt.value); }}
                          className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50"
                        >
                          {opt.label}
                          {isOther && <span className="ml-1 text-xs font-normal text-gray-400">(type your answer below)</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {m.context && <DraftPreview draft={m.context} applied={Boolean(m.applied)} onApply={() => applyDraft(m.id, m.context!)} />}
              </div>
            )}
          </div>
        ))}
        {messages.length === 1 && !sending && (
          <button
            type="button"
            onClick={() => void send("I don't have a link or any context to share. Ask me a few quick questions to capture the basics.")}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50"
          >
            I don't have a link or context
          </button>
        )}
        {sending && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      </div>

      <form onSubmit={e => { e.preventDefault(); void send(input); }} className="flex items-end gap-2 border-t border-gray-100 p-2.5">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={markInteracted}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          rows={1}
          placeholder={awaitingChoice ? 'Pick an option above, or type your own…' : listening ? 'Listening…' : 'Paste a link, type, or use the mic…'}
          className="max-h-28 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none disabled:bg-gray-50"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={() => { markInteracted(); toggleDictation(); }}
            disabled={sending}
            className={`rounded-lg p-2 transition-colors disabled:opacity-40 ${
              listening ? 'bg-red-500 text-white animate-pulse' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            aria-label={listening ? 'Stop dictation' : 'Dictate with your voice'}
            title={listening ? 'Stop dictation' : 'Dictate with your voice'}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="rounded-lg bg-brand-primary p-2 text-white hover:bg-brand-primary-dark disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
