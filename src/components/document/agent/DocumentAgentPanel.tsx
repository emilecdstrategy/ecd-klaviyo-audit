import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, FileText, History, Loader2, MessageSquare, Mic, Paperclip, Send, Sparkles, Square, SquarePen, Trash2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAudioTranscription } from '../../../hooks/useAudioTranscription';
import { useToast } from '../../ui/Toast';
import { RichAuditContent } from '../../ui/RichAuditText';
import { uploadDocumentAgentFile, type DocDraftPayload, type DocEditPayload } from '../../../lib/document-agent';
import type { ProposalAgentAttachment } from '../../../lib/types';
import { useDocumentAgent, type DocAgentChatMessage, type ConversationSummary } from './DocumentAgentContext';

type AgentQuestion = { question: string; options: Array<{ label: string; value: string }>; multi_select?: boolean };

const TYPING_LABELS = ['Thinking', 'Reading your notes', 'Reviewing templates', 'Drafting the document'];

function TypingIndicator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI(v => (v + 1) % TYPING_LABELS.length), 4000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 [animation-delay:400ms]" />
      </span>
      <span className="leading-none">{TYPING_LABELS[i]}…</span>
    </div>
  );
}

function QuestionChips({ question, active, onAnswer }: { question: AgentQuestion; active: boolean; onAnswer: (v: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const multi = Boolean(question.multi_select);
  if (!active) return null;
  return (
    <div className="mt-3 space-y-2">
      {question.options.map(opt => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.label}
            onClick={() => {
              if (!multi) return onAnswer(opt.value);
              setSelected(prev => (isSelected ? prev.filter(v => v !== opt.value) : [...prev, opt.value]));
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors',
              isSelected ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50',
            )}
          >
            {multi && (
              <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', isSelected ? 'border-brand-primary bg-brand-primary text-white' : 'border-gray-300')}>
                {isSelected && <Check className="h-3 w-3" />}
              </span>
            )}
            <span className="flex-1">{opt.label}</span>
          </button>
        );
      })}
      {otherOpen ? (
        <div className="rounded-xl border border-brand-primary/40 bg-white p-2">
          <textarea
            autoFocus
            value={otherText}
            onChange={e => setOtherText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (otherText.trim()) onAnswer(otherText.trim());
              }
            }}
            rows={2}
            placeholder="Type your own answer…"
            className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setOtherOpen(false); setOtherText(''); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={() => otherText.trim() && onAnswer(otherText.trim())} disabled={!otherText.trim()} className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-40">Send</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOtherOpen(true)} className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-gray-300 px-3.5 py-2.5 text-left text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700">
          Other (type your own answer)…
        </button>
      )}
      {multi && selected.length > 0 && (
        <button onClick={() => onAnswer(selected.join('; '))} className="w-full rounded-xl bg-brand-primary px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark">
          Send {selected.length} selected
        </button>
      )}
    </div>
  );
}

function DraftPreviewCard({ draft }: { draft: DocDraftPayload }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">Document draft</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{draft.title}</p>
      <p className="mt-1.5 text-xs text-gray-500">{draft.summary}</p>
      <button onClick={() => setExpanded(v => !v)} className="mt-2 text-xs font-medium text-brand-primary hover:underline">
        {expanded ? 'Hide preview' : 'Preview document'}
      </button>
      {expanded && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg bg-white p-3 ring-1 ring-gray-100">
          <RichAuditContent text={draft.content} className="text-xs leading-relaxed text-gray-600" autoTagEntities={false} />
        </div>
      )}
    </div>
  );
}

function EditPreviewCard({ edits }: { edits: DocEditPayload }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">Proposed changes</p>
      <p className="mt-1.5 text-xs text-gray-500">{edits.summary}</p>
      <button onClick={() => setExpanded(v => !v)} className="mt-2 text-xs font-medium text-brand-primary hover:underline">
        {expanded ? 'Hide preview' : 'Preview revised document'}
      </button>
      {expanded && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg bg-white p-3 ring-1 ring-gray-100">
          <RichAuditContent text={edits.content} className="text-xs leading-relaxed text-gray-600" autoTagEntities={false} />
        </div>
      )}
    </div>
  );
}

function ApplyFooter({ applying, applied, canApply, onApply, onDiscard, discarded }: {
  applying: boolean; applied: boolean; canApply: boolean; onApply: () => void; onDiscard: () => void; discarded: boolean;
}) {
  if (applied) return <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Applied</div>;
  if (discarded) return <div className="mt-3 text-xs text-gray-400">Discarded. Ask for changes to get a new version.</div>;
  if (!canApply) return null;
  return (
    <div className="mt-3 flex gap-2">
      <button onClick={onApply} disabled={applying} className="rounded-lg bg-brand-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-60">
        {applying ? 'Applying…' : 'Apply'}
      </button>
      <button onClick={onDiscard} disabled={applying} className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60">Discard</button>
    </div>
  );
}

function MessageBubble({ message, isLast, onAnswer }: { message: DocAgentChatMessage; isLast: boolean; onAnswer: (v: string) => void }) {
  const { applyMessage, applyingMessageId, canApply } = useDocumentAgent();
  const [discarded, setDiscarded] = useState(false);

  if (message.role === 'user') {
    const atts = message.attachments ?? [];
    return (
      <div className="flex flex-col items-end px-4 py-1.5">
        {message.actorName && <p className="mb-0.5 pr-1 text-[11px] font-medium text-gray-400">{message.actorName}</p>}
        <div className={cn('flex max-w-[85%] flex-col items-end gap-1.5', message.pending && 'opacity-70')}>
          {atts.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-3 py-2 text-xs font-medium text-brand-primary hover:bg-brand-primary/10" title={a.name}>
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{a.name}</span>
            </a>
          ))}
          {message.content && (
            <div className="rounded-2xl rounded-br-md bg-brand-primary px-3.5 py-2 text-sm text-white">
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const question = message.payload_kind === 'question' ? (message.payload as AgentQuestion) : null;
  const draft = message.payload_kind === 'draft' ? (message.payload as DocDraftPayload) : null;
  const edits = message.payload_kind === 'edits' ? (message.payload as DocEditPayload) : null;
  const showApply = Boolean(draft || edits);

  return (
    <div className="px-4 py-1.5">
      <div className="max-w-[92%]">
        {message.content && (
          <RichAuditContent text={message.content} className="text-sm leading-relaxed text-gray-700 break-words [overflow-wrap:anywhere] [&_ul]:list-disc [&_ul]:pl-4" autoTagEntities={false} />
        )}
        {question && (
          <>
            {!message.content && <p className="text-sm text-gray-700">{question.question}</p>}
            {message.content && !message.content.includes(question.question) && <p className="mt-1 text-sm text-gray-700">{question.question}</p>}
            <QuestionChips question={question} active={isLast} onAnswer={onAnswer} />
          </>
        )}
        {draft && <DraftPreviewCard draft={draft} />}
        {edits && <EditPreviewCard edits={edits} />}
        {showApply && (
          <ApplyFooter
            applying={applyingMessageId === message.id}
            applied={Boolean(message.applied_at)}
            canApply={canApply && isLast && !discarded}
            onApply={() => void applyMessage(message)}
            onDiscard={() => setDiscarded(true)}
            discarded={discarded}
          />
        )}
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChatHistoryList({ conversations, loading, currentId, onSelect, onDelete, onBack }: {
  conversations: ConversationSummary[]; loading: boolean; currentId: string | null;
  onSelect: (id: string) => void; onDelete: (id: string) => void; onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 px-4">
        <button onClick={onBack} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Back to chat"><ArrowLeft className="h-4 w-4" /></button>
        <p className="flex-1 text-sm font-semibold text-gray-900">Chat history</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="px-1 py-2 text-xs text-gray-400">Loading chats…</p>
        ) : conversations.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-gray-400">No saved chats yet.</p>
        ) : (
          <div className="space-y-1">
            {conversations.map(c => (
              <div key={c.id} className={cn('group flex items-start gap-2 rounded-lg border pr-1.5', c.id === currentId ? 'border-brand-primary/40 bg-brand-primary/[0.04]' : 'border-transparent hover:border-gray-200 hover:bg-gray-50')}>
                <button onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left">
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{c.title || 'Untitled chat'}</span>
                    <span className="mt-0.5 block text-xs text-gray-400">{relativeTime(c.updated_at)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}{c.id === currentId ? ' · current' : ''}</span>
                  </span>
                </button>
                <button onClick={() => onDelete(c.id)} className="mt-1.5 shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 lg:opacity-0 lg:group-hover:opacity-100" aria-label="Delete chat" title="Delete chat"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentAgentPanel() {
  const {
    isOpen, close, messages, sending, loadingHistory, error, sendMessage, resetChat,
    historyView, openHistory, closeHistory, conversations, conversationsLoading, conversationId,
    selectConversation, deleteConversation,
  } = useDocumentAgent();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  type Pending = { id: string; name: string; status: 'uploading' | 'ready'; attachment?: ProposalAgentAttachment };
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollDown = () => { el.scrollTop = el.scrollHeight; };
    scrollDown();
    const r = requestAnimationFrame(() => { scrollDown(); requestAnimationFrame(scrollDown); });
    return () => cancelAnimationFrame(r);
  }, [messages, sending, isOpen, loadingHistory]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, isOpen]);

  const lastMessage = messages[messages.length - 1];
  const awaitingChoice = !sending && !loadingHistory && lastMessage?.role === 'assistant' && lastMessage.payload_kind === 'question';

  const readyAttachments = pending.filter(p => p.status === 'ready' && p.attachment).map(p => p.attachment as ProposalAgentAttachment);
  const uploadingAttachment = pending.some(p => p.status === 'uploading');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (sending || awaitingChoice || uploadingAttachment) return;
    if (!input.trim() && readyAttachments.length === 0) return;
    void sendMessage(input, readyAttachments);
    setInput('');
    setPending([]);
  };

  const onFilesSelected = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (fileInputRef.current) fileInputRef.current.value = '';
    for (const file of files) {
      const id = `att_${Math.random().toString(36).slice(2, 9)}`;
      setPending(prev => [...prev, { id, name: file.name, status: 'uploading' }]);
      try {
        const attachment = await uploadDocumentAgentFile(file, conversationId);
        setPending(prev => prev.map(p => (p.id === id ? { ...p, status: 'ready', attachment } : p)));
      } catch (err) {
        setPending(prev => prev.filter(p => p.id !== id));
        showToast(err instanceof Error ? err.message : 'The file could not be uploaded.');
      }
    }
  };
  const removePending = (id: string) => setPending(prev => prev.filter(p => p.id !== id));

  const { supported: voiceSupported, status: voiceStatus, start: startRecording, stop: stopRecording } = useAudioTranscription({
    onText: text => { setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text)); inputRef.current?.focus(); },
    onError: kind => {
      if (kind === 'not-allowed') showToast('Microphone access was blocked. Allow it in your browser settings to use voice input.');
      else if (kind === 'no-device') showToast('No microphone was found.');
      else if (kind === 'unsupported') showToast("This browser doesn't support voice input.");
      else if (kind === 'empty') showToast("Didn't catch any audio. Please try again.");
      else showToast("Voice input didn't work. Please try again.");
    },
  });
  const toggleRecording = () => { if (voiceStatus === 'recording') stopRecording(); else if (voiceStatus === 'idle') void startRecording(); };
  useEffect(() => { if (awaitingChoice && voiceStatus === 'recording') stopRecording(); }, [awaitingChoice, voiceStatus, stopRecording]);

  const body = historyView ? (
    <ChatHistoryList
      conversations={conversations}
      loading={conversationsLoading}
      currentId={conversationId}
      onSelect={id => void selectConversation(id)}
      onDelete={id => { if (window.confirm('Delete this chat? This cannot be undone.')) void deleteConversation(id); }}
      onBack={closeHistory}
    />
  ) : (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-gray-100 px-4">
        <Sparkles className="h-4 w-4 text-brand-primary" />
        <p className="flex-1 text-sm font-semibold text-gray-900">AI Assistant</p>
        <button onClick={openHistory} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700" title="Chat history"><History className="h-3.5 w-3.5" /> History</button>
        {messages.length > 0 && (
          <button onClick={resetChat} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700" title="Start a new chat"><SquarePen className="h-3.5 w-3.5" /> New</button>
        )}
        <button onClick={close} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Close assistant"><X className="h-4 w-4" /></button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {loadingHistory && messages.length === 0 ? (
          <p className="px-4 py-2 text-xs text-gray-400">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="px-4 py-6">
            <p className="text-sm font-medium text-gray-900">Let's write a document.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              Describe the document you need (an agreement, acknowledgement, policy, memo), paste or upload source text, or drop a Google Docs link. I'll ask a couple of questions and draft it for you to review and apply.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble key={m.id} message={m} isLast={i === messages.length - 1 && !sending} onAnswer={value => void sendMessage(value)} />
          ))
        )}
        {sending && <TypingIndicator />}
        {error && <p className="mx-4 my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-gray-100 p-3">
        {awaitingChoice && <p className="mb-2 px-1 text-xs text-gray-400">Choose an option above to continue.</p>}
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pending.map(p => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600">
                {p.status === 'uploading' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-400" /> : <FileText className="h-3 w-3 shrink-0 text-brand-primary" />}
                <span className="max-w-[160px] truncate" title={p.name}>{p.name}</span>
                <button type="button" onClick={() => removePending(p.id)} className="text-gray-300 hover:text-red-500" aria-label={`Remove ${p.name}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={e => void onFilesSelected(e.target.files)} />
        <div className={cn('flex items-end gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 focus-within:border-brand-primary/50', awaitingChoice && 'opacity-50')}>
          <textarea
            ref={inputRef}
            value={input}
            disabled={awaitingChoice}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={2}
            placeholder={awaitingChoice ? 'Pick an option above…' : voiceStatus === 'recording' ? 'Recording… click the square to stop' : voiceStatus === 'transcribing' ? 'Transcribing…' : 'Message the assistant…'}
            className="max-h-[200px] min-h-[3rem] flex-1 resize-none bg-transparent text-sm leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || awaitingChoice} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40" aria-label="Attach a PDF" title="Attach a PDF"><Paperclip className="h-3.5 w-3.5" /></button>
          {voiceSupported && (
            <button type="button" onClick={toggleRecording} disabled={sending || awaitingChoice || voiceStatus === 'transcribing'} className={cn('rounded-lg p-1.5 transition-colors disabled:opacity-40', voiceStatus === 'recording' ? 'animate-pulse bg-red-500 text-white hover:bg-red-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600')} aria-label="Voice input">
              {voiceStatus === 'recording' ? <Square className="h-3.5 w-3.5" /> : voiceStatus === 'transcribing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="submit" disabled={(!input.trim() && readyAttachments.length === 0) || sending || awaitingChoice || uploadingAttachment} className="rounded-lg bg-brand-primary p-1.5 text-white hover:bg-brand-primary-dark disabled:opacity-40" aria-label="Send message"><Send className="h-3.5 w-3.5" /></button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      <div aria-hidden className={cn('hidden shrink-0 transition-[width] duration-300 ease-in-out lg:block', isOpen ? 'w-[340px] xl:w-[380px] 2xl:w-[420px]' : 'w-0')} />
      <div className={cn('fixed right-0 top-0 z-30 hidden h-screen w-[340px] transform border-l border-gray-100 bg-white shadow-sm transition-transform duration-300 ease-in-out lg:block xl:w-[380px] 2xl:w-[420px]', isOpen ? 'translate-x-0' : 'translate-x-full')}>
        {body}
      </div>
      {isOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-black/20" onClick={close} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[400px] shadow-xl">{body}</div>
        </div>
      )}
    </>
  );
}
