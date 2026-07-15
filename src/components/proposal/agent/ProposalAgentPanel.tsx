import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, History, Loader2, MessageSquare, Mic, Send, Sparkles, Square, SquarePen, Trash2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAudioTranscription } from '../../../hooks/useAudioTranscription';
import { useToast } from '../../ui/Toast';
import { formatCurrency } from '../../../lib/revenue-calculator';
import { RichAuditContent } from '../../ui/RichAuditText';
import { useProposalAgent, type AgentChatMessage, type ConversationSummary } from './ProposalAgentContext';
import type {
  AgentQuestion,
  ProposalDraftPayload,
  ProposalEditOp,
  ProposalEditSet,
} from '../../../lib/proposal-agent';

const TYPING_LABELS = [
  'Thinking',
  'Reading your document',
  'Reviewing the catalog',
  'Drafting sections',
  'Working on line items',
];

function TypingIndicator() {
  const [labelIndex, setLabelIndex] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setLabelIndex(i => (i + 1) % TYPING_LABELS.length), 4000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 [animation-delay:400ms]" />
      </span>
      <span className="leading-none">{TYPING_LABELS[labelIndex]}…</span>
    </div>
  );
}

function QuestionChips({
  question,
  active,
  onAnswer,
}: {
  question: AgentQuestion;
  active: boolean;
  onAnswer: (value: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const otherRef = useRef<HTMLDivElement>(null);
  const multi = Boolean(question.multi_select);

  // Opening the free-text box grows the panel; bring it into view so the
  // textarea is fully visible without manual scrolling.
  useEffect(() => {
    if (otherOpen) otherRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [otherOpen]);

  if (!active) return null;

  return (
    <div className="mt-3 space-y-2">
      {question.options.map(opt => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.label}
            onClick={() => {
              if (!multi) {
                onAnswer(opt.value);
                return;
              }
              setSelected(prev =>
                isSelected ? prev.filter(v => v !== opt.value) : [...prev, opt.value],
              );
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors',
              isSelected
                ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                : 'border-gray-200 bg-white text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50',
            )}
          >
            {multi && (
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  isSelected ? 'border-brand-primary bg-brand-primary text-white' : 'border-gray-300',
                )}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </span>
            )}
            <span className="flex-1">{opt.label}</span>
          </button>
        );
      })}

      {otherOpen ? (
        <div ref={otherRef} className="rounded-xl border border-brand-primary/40 bg-white p-2">
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
            <button
              onClick={() => {
                setOtherOpen(false);
                setOtherText('');
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => otherText.trim() && onAnswer(otherText.trim())}
              disabled={!otherText.trim()}
              className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOtherOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-gray-300 px-3.5 py-2.5 text-left text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          Other (type your own answer)…
        </button>
      )}

      {multi && selected.length > 0 && (
        <button
          onClick={() => onAnswer(selected.join('; '))}
          className="w-full rounded-xl bg-brand-primary px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary-dark"
        >
          Send {selected.length} selected
        </button>
      )}
    </div>
  );
}

function priceLine(item: {
  one_time_price: number | null;
  monthly_price: number | null;
}): string {
  const parts: string[] = [];
  if (item.one_time_price != null) parts.push(formatCurrency(item.one_time_price));
  if (item.monthly_price != null) parts.push(`${formatCurrency(item.monthly_price)}/mo`);
  return parts.join(' + ') || 'No price';
}

function ApplyFooter({
  message,
  applying,
  applied,
  canApply,
  onApply,
  onDiscard,
  discarded,
}: {
  message: AgentChatMessage;
  applying: boolean;
  applied: boolean;
  canApply: boolean;
  onApply: () => void;
  onDiscard: () => void;
  discarded: boolean;
}) {
  if (applied) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <Check className="h-3.5 w-3.5" /> Applied
      </div>
    );
  }
  if (discarded) {
    return <div className="mt-3 text-xs text-gray-400">Discarded. Ask for changes to get a new version.</div>;
  }
  if (!canApply) return null;
  return (
    <div className="mt-3 flex gap-2">
      <button
        onClick={onApply}
        disabled={applying}
        className="rounded-lg bg-brand-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-60"
      >
        {applying ? 'Applying…' : 'Apply'}
      </button>
      <button
        onClick={onDiscard}
        disabled={applying}
        className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
      >
        Discard
      </button>
      <span className="ml-auto self-center text-[10px] text-gray-400" data-message-id={message.id} />
    </div>
  );
}

function DraftPreviewCard({ draft }: { draft: ProposalDraftPayload }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">Proposal draft</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{draft.title}</p>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 rounded p-1 text-gray-400 hover:bg-white hover:text-gray-600"
          aria-label={expanded ? 'Collapse draft details' : 'Expand draft details'}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-gray-500">{draft.summary}</p>

      <div className="mt-3 space-y-1">
        {draft.line_items.map((item, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-gray-700">{item.name}</span>
            <span className="shrink-0 font-semibold text-gray-900">{priceLine(item)}</span>
          </div>
        ))}
        {draft.discount && draft.discount.type !== 'none' && (
          <div className="flex items-baseline justify-between gap-3 text-xs text-emerald-700">
            <span>{draft.discount.label || 'Discount'}</span>
            <span>
              {draft.discount.type === 'percent'
                ? `${draft.discount.value}%`
                : formatCurrency(draft.discount.value)}{' '}
              off
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {draft.content_blocks.map((b, i) => (
          <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
            {b.title}
          </span>
        ))}
        {(draft.include_contracts ?? []).map(slug => (
          <span key={slug} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-brand-primary ring-1 ring-brand-primary/30">
            {slug === 'msa' ? 'MSA' : slug.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg bg-white p-3 ring-1 ring-gray-100">
          {draft.content_blocks.map((b, i) => (
            <div key={i}>
              <p className="text-xs font-semibold text-gray-900">{b.title}</p>
              <RichAuditContent
                text={b.content}
                className="mt-1 text-xs leading-relaxed text-gray-600"
                autoTagEntities={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeOp(op: ProposalEditOp): string {
  switch (op.op) {
    case 'update_title':
      return `Rename the proposal to "${op.title}"`;
    case 'update_block':
      return `Update section${op.title ? ` title to "${op.title}"` : ''}${op.content != null ? ' content' : ''}`;
    case 'add_block':
      return `Add section "${op.title}"`;
    case 'remove_block':
      return 'Remove a section';
    case 'add_line_item':
      return `Add line item "${op.item.name}" (${priceLine(op.item)})`;
    case 'update_line_item': {
      const fields = Object.keys(op.patch).join(', ');
      return `Update line item (${fields})`;
    }
    case 'delete_line_item':
      return 'Remove a line item';
    case 'update_discount':
      return op.discount.type === 'none'
        ? 'Remove the discount'
        : `Set discount: ${op.discount.type === 'percent' ? `${op.discount.value}%` : formatCurrency(op.discount.value)} off ${op.discount.applies_to.replace('_', '-')}`;
    case 'toggle_contract':
      return `${op.included ? 'Attach' : 'Detach'} contract: ${op.slug === 'msa' ? 'MSA' : op.slug.replace(/_/g, ' ')}`;
    case 'update_recipient':
      return `Update recipient${op.recipient_name ? ` name to ${op.recipient_name}` : ''}${op.recipient_email ? ` email to ${op.recipient_email}` : ''}`;
  }
}

function EditSetPreviewCard({
  edits,
  blockTitles,
  itemNames,
}: {
  edits: ProposalEditSet;
  blockTitles: Map<string, string>;
  itemNames: Map<string, string>;
}) {
  return (
    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.03] p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">Proposed edits</p>
      <p className="mt-1.5 text-xs text-gray-500">{edits.summary}</p>
      <ul className="mt-3 space-y-1.5">
        {edits.operations.map((op, i) => {
          let detail = describeOp(op);
          if (op.op === 'update_block' || op.op === 'remove_block') {
            const t = blockTitles.get(op.block_key);
            if (t) detail = `${op.op === 'remove_block' ? 'Remove' : 'Update'} section "${t}"${op.op === 'update_block' && op.content != null ? ' content' : ''}`;
          }
          if (op.op === 'update_line_item' || op.op === 'delete_line_item') {
            const n = itemNames.get(op.item_id);
            if (n) {
              detail =
                op.op === 'delete_line_item'
                  ? `Remove line item "${n}"`
                  : `Update line item "${n}" (${Object.keys(op.patch).join(', ')})`;
            }
          }
          return (
            <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-primary/60" />
              {detail}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageBubble({
  message,
  isLast,
  blockTitles,
  itemNames,
  onAnswer,
}: {
  message: AgentChatMessage;
  isLast: boolean;
  blockTitles: Map<string, string>;
  itemNames: Map<string, string>;
  onAnswer: (value: string) => void;
}) {
  const { applyMessage, applyingMessageId, canApply } = useProposalAgent();
  const [discarded, setDiscarded] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end px-4 py-1.5">
        {message.actorName && (
          <p className="mb-0.5 pr-1 text-[11px] font-medium text-gray-400">{message.actorName}</p>
        )}
        <div className={cn('max-w-[85%] rounded-2xl rounded-br-md bg-brand-primary px-3.5 py-2 text-sm text-white', message.pending && 'opacity-70')}>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
        </div>
      </div>
    );
  }

  const question = message.payload_kind === 'question' ? (message.payload as AgentQuestion) : null;
  const draft = message.payload_kind === 'draft' ? (message.payload as ProposalDraftPayload) : null;
  const edits = message.payload_kind === 'edits' ? (message.payload as ProposalEditSet) : null;
  const showApply = Boolean(draft || edits);

  return (
    <div className="px-4 py-1.5">
      <div className="max-w-[92%]">
        {message.content && (
          <RichAuditContent
            text={message.content}
            className="text-sm leading-relaxed text-gray-700 break-words [overflow-wrap:anywhere] [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-1"
            autoTagEntities={false}
          />
        )}
        {question && (
          <>
            {!message.content && <p className="text-sm text-gray-700">{question.question}</p>}
            {message.content && !message.content.includes(question.question) && (
              <p className="mt-1 text-sm text-gray-700">{question.question}</p>
            )}
            <QuestionChips question={question} active={isLast} onAnswer={onAnswer} />
          </>
        )}
        {draft && <DraftPreviewCard draft={draft} />}
        {edits && <EditSetPreviewCard edits={edits} blockTitles={blockTitles} itemNames={itemNames} />}
        {showApply && (
          <ApplyFooter
            message={message}
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
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChatHistoryList({
  conversations,
  loading,
  currentId,
  onSelect,
  onDelete,
  onBack,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 px-4">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
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
              <div
                key={c.id}
                className={cn(
                  'group flex items-start gap-2 rounded-lg border pr-1.5 transition-colors',
                  c.id === currentId
                    ? 'border-brand-primary/40 bg-brand-primary/[0.04]'
                    : 'border-transparent hover:border-gray-200 hover:bg-gray-50',
                )}
              >
                <button
                  onClick={() => onSelect(c.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left"
                >
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{c.title || 'Untitled chat'}</span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      {relativeTime(c.updated_at)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                      {c.id === currentId ? ' · current' : ''}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onDelete(c.id)}
                  className="mt-1.5 shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 lg:opacity-0 lg:group-hover:opacity-100"
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProposalAgentPanel({
  blockTitles,
  itemNames,
}: {
  /** key -> title map for readable edit previews (pass from pages with an open proposal). */
  blockTitles?: Map<string, string>;
  /** line item id -> name map for readable edit previews. */
  itemNames?: Map<string, string>;
}) {
  const {
    isOpen,
    close,
    messages,
    sending,
    loadingHistory,
    error,
    sendMessage,
    resetChat,
    historyView,
    openHistory,
    closeHistory,
    conversations,
    conversationsLoading,
    conversationId,
    selectConversation,
    deleteConversation,
  } = useProposalAgent();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Scroll after paint so it lands at the bottom even once markdown/preview
    // content has expanded the list height (e.g. when opening a saved chat).
    const scrollDown = () => {
      el.scrollTop = el.scrollHeight;
    };
    scrollDown();
    const r1 = requestAnimationFrame(() => {
      scrollDown();
      requestAnimationFrame(scrollDown);
    });
    return () => cancelAnimationFrame(r1);
  }, [messages, sending, isOpen, loadingHistory]);

  // Auto-grow the composer as the user types or pastes long content.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, isOpen]);

  // While the assistant is waiting on a choice, block the free-form composer so
  // the answer flows through the options (the "Other" chip handles free text).
  const lastMessage = messages[messages.length - 1];
  const awaitingChoice =
    !sending && !loadingHistory && lastMessage?.role === 'assistant' && lastMessage.payload_kind === 'question';

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || sending || awaitingChoice) return;
    void sendMessage(input);
    setInput('');
  };

  // Voice input: record mic audio, transcribe server-side (OpenAI Whisper), and
  // append the result to whatever is already in the composer for review/edit.
  const showToast = useToast();
  const {
    supported: voiceSupported,
    status: voiceStatus,
    start: startRecording,
    stop: stopRecording,
  } = useAudioTranscription({
    onText: (text) => {
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      inputRef.current?.focus();
    },
    onError: (kind) => {
      if (kind === 'not-allowed') {
        showToast('Microphone access was blocked. Allow it in your browser settings to use voice input.');
      } else if (kind === 'no-device') {
        showToast('No microphone was found.');
      } else if (kind === 'unsupported') {
        showToast("This browser doesn't support voice input.");
      } else if (kind === 'empty') {
        showToast("Didn't catch any audio. Please try again.");
      } else {
        showToast("Voice input didn't work. Please try again.");
      }
    },
  });

  const toggleRecording = () => {
    if (voiceStatus === 'recording') stopRecording();
    else if (voiceStatus === 'idle') void startRecording();
  };

  // Stop recording if the composer gets disabled (assistant asked a question).
  useEffect(() => {
    if (awaitingChoice && voiceStatus === 'recording') stopRecording();
  }, [awaitingChoice, voiceStatus, stopRecording]);

  const body = historyView ? (
    <ChatHistoryList
      conversations={conversations}
      loading={conversationsLoading}
      currentId={conversationId}
      onSelect={id => void selectConversation(id)}
      onDelete={id => {
        if (window.confirm('Delete this chat? This cannot be undone.')) void deleteConversation(id);
      }}
      onBack={closeHistory}
    />
  ) : (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-gray-100 px-4">
        <Sparkles className="h-4 w-4 text-brand-primary" />
        <p className="flex-1 text-sm font-semibold text-gray-900">AI Assistant</p>
        <button
          onClick={openHistory}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          title="Chat history"
        >
          <History className="h-3.5 w-3.5" />
          History
        </button>
        {messages.length > 0 && (
          <button
            onClick={resetChat}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            title="Start a new chat"
          >
            <SquarePen className="h-3.5 w-3.5" />
            New
          </button>
        )}
        <button
          onClick={close}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          aria-label="Close assistant"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {loadingHistory && messages.length === 0 ? (
          <p className="px-4 py-2 text-xs text-gray-400">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="px-4 py-6">
            <p className="text-sm font-medium text-gray-900">Let's build a proposal.</p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              Drop a Google Docs link (set to "Anyone with the link can view") or a Fireflies meeting
              link, paste the text directly, or just describe what you need. I'll ask a few questions
              and draft the full proposal for you to review and apply.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              isLast={i === messages.length - 1 && !sending}
              blockTitles={blockTitles ?? new Map()}
              itemNames={itemNames ?? new Map()}
              onAnswer={value => void sendMessage(value)}
            />
          ))
        )}
        {sending && <TypingIndicator />}
        {error && (
          <p className="mx-4 my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-gray-100 p-3">
        {awaitingChoice && (
          <p className="mb-2 px-1 text-xs text-gray-400">Choose an option above to continue.</p>
        )}
        <div
          className={cn(
            'flex items-end gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 focus-within:border-brand-primary/50',
            awaitingChoice && 'opacity-50',
          )}
        >
          <textarea
            ref={inputRef}
            value={input}
            disabled={awaitingChoice}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={
              awaitingChoice
                ? 'Pick an option above…'
                : voiceStatus === 'recording'
                  ? 'Recording… click the square to stop'
                  : voiceStatus === 'transcribing'
                    ? 'Transcribing…'
                    : 'Message the assistant…'
            }
            className="max-h-[200px] min-h-[3rem] flex-1 resize-none bg-transparent text-sm leading-relaxed text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={sending || awaitingChoice || voiceStatus === 'transcribing'}
              className={cn(
                'rounded-lg p-1.5 transition-colors disabled:opacity-40',
                voiceStatus === 'recording'
                  ? 'animate-pulse bg-red-500 text-white hover:bg-red-600'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
              )}
              aria-label={
                voiceStatus === 'recording' ? 'Stop recording' : voiceStatus === 'transcribing' ? 'Transcribing' : 'Start voice input'
              }
              title={
                voiceStatus === 'recording'
                  ? 'Stop recording'
                  : voiceStatus === 'transcribing'
                    ? 'Transcribing…'
                    : 'Speak your message'
              }
            >
              {voiceStatus === 'recording' ? (
                <Square className="h-3.5 w-3.5" />
              ) : voiceStatus === 'transcribing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || sending || awaitingChoice}
            className="rounded-lg bg-brand-primary p-1.5 text-white hover:bg-brand-primary-dark disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <>
      {/* Desktop: spacer reserves width so page content shrinks; the panel
          itself is fixed to the viewport so it stays put while the page scrolls. */}
      <div
        aria-hidden
        className={cn(
          'hidden shrink-0 transition-[width] duration-300 ease-in-out lg:block',
          isOpen ? 'w-[420px]' : 'w-0',
        )}
      />
      <div
        className={cn(
          'fixed right-0 top-0 z-30 hidden h-screen w-[420px] transform border-l border-gray-100 bg-white shadow-sm transition-transform duration-300 ease-in-out lg:block',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {body}
      </div>

      {/* Mobile: overlay */}
      {isOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-black/20" onClick={close} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[400px] shadow-xl">{body}</div>
        </div>
      )}
    </>
  );
}
