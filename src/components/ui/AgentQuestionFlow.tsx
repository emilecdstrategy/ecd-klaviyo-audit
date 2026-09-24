import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  formatAnswers,
  questionItems,
  type AgentQuestionItem,
  type AgentQuestionPayload,
} from '../../lib/agent-questions';

function QuestionChips({
  question,
  isFinal = true,
  onAnswer,
}: {
  question: AgentQuestionItem;
  /** False while more questions follow, so the multi-select button reads Next. */
  isFinal?: boolean;
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
          {isFinal ? `Send ${selected.length} selected` : `Next (${selected.length} selected)`}
        </button>
      )}
    </div>
  );
}

function answerLabel(item: AgentQuestionItem, answer: string): string {
  return item.options.find(o => o.value === answer)?.label ?? answer;
}

/**
 * The clickable answer area under an assistant question. One question behaves
 * as it always has: a click sends. Several are asked one at a time, with the
 * earlier answers listed above and a Back link, and all of them go back to the
 * assistant together once the last one is answered.
 */
export default function AgentQuestionFlow({
  payload,
  messageText,
  active,
  onAnswer,
}: {
  payload: AgentQuestionPayload;
  /** The assistant's reply text, so a question it already spelled out is not repeated. */
  messageText: string;
  active: boolean;
  onAnswer: (value: string) => void;
}) {
  const items = questionItems(payload);
  const [answers, setAnswers] = useState<string[]>([]);
  const step = answers.length;

  if (items.length === 1) {
    const q = items[0];
    return (
      <>
        {!messageText.includes(q.question) && (
          <p className={cn('text-sm text-gray-700', messageText && 'mt-1')}>{q.question}</p>
        )}
        {active && <QuestionChips question={q} onAnswer={onAnswer} />}
      </>
    );
  }

  if (!active) {
    // Already answered: show what was asked; the reply below carries the answers.
    return (
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700 marker:text-gray-400">
        {items.map((q, i) => <li key={i}>{q.question}</li>)}
      </ol>
    );
  }

  const current = items[Math.min(step, items.length - 1)];

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Question {Math.min(step + 1, items.length)} of {items.length}
        </span>
        <div className="flex items-center gap-1" aria-hidden>
          {items.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i < step ? 'w-3 bg-brand-primary' : i === step ? 'w-5 bg-brand-primary/60' : 'w-3 bg-gray-200',
              )}
            />
          ))}
        </div>
      </div>

      {step > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {answers.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-gray-500">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
              <span>
                <span className="text-gray-700">{items[i].question}</span>{' '}
                <span className="font-medium text-gray-900">{answerLabel(items[i], a)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-sm font-medium text-gray-900">{current.question}</p>
      <QuestionChips
        key={step}
        question={current}
        isFinal={step === items.length - 1}
        onAnswer={value => {
          const next = [...answers, value];
          if (next.length === items.length) onAnswer(formatAnswers(items, next));
          else setAnswers(next);
        }}
      />

      {step > 0 && (
        <button
          onClick={() => setAnswers(prev => prev.slice(0, -1))}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      )}
    </div>
  );
}
