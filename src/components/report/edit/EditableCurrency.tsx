import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatCurrency } from '../../../lib/revenue-calculator';
import { useReportEdit } from './ReportEditContext';

type EditableCurrencyProps = {
  value: number;
  onSave?: (value: number) => void;
  className?: string;
  inputClassName?: string;
  suffix?: string;
  suffixClassName?: string;
  /** Light inputs on dark banners (total opportunity cards). */
  variant?: 'default' | 'on-dark' | 'compact';
  /** Multiplier for content-sized input width (e.g. 2 for wider add-on fields). */
  inputWidthScale?: number;
};

function parseCurrencyInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function inputCharWidth(raw: string): number {
  return Math.max(3, (raw || '0').length);
}

export default function EditableCurrency({
  value,
  onSave,
  className,
  inputClassName,
  suffix,
  suffixClassName,
  variant = 'default',
  inputWidthScale = 1,
}: EditableCurrencyProps) {
  const { editMode } = useReportEdit();
  const [raw, setRaw] = useState(value ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const charWidth = inputCharWidth(raw);
  const inputWidthCh = Math.ceil((charWidth + 1) * inputWidthScale);

  useEffect(() => {
    setRaw(value ? String(value) : '');
  }, [value]);

  const canEdit = editMode && Boolean(onSave);

  const commit = (nextRaw = raw) => {
    const next = parseCurrencyInput(nextRaw);
    if (next !== value) onSave?.(next);
    setRaw(next ? String(next) : '');
  };

  const scheduleCommit = (nextRaw: string) => {
    setRaw(nextRaw);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => commit(nextRaw), 600) as unknown as number;
  };

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  if (!canEdit) {
    return (
      <span className={className}>
        {formatCurrency(value || 0)}
        {suffix ? <span className={suffixClassName}>{suffix}</span> : null}
      </span>
    );
  }

  const inputStyles =
    variant === 'on-dark'
      ? 'border-white/30 bg-white/10 text-white placeholder:text-white/40 focus:border-white/60 focus:ring-white/20'
      : 'border-brand-primary/30 bg-white text-gray-900 focus:border-brand-primary focus:ring-brand-primary/20';

  const showIcon = variant === 'default';

  return (
    <label
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 group',
        variant === 'on-dark' && 'gap-0.5',
        className,
      )}
      title="Edit revenue opportunity ($/mo)"
    >
      <span
        className={cn(
          'shrink-0 opacity-70',
          variant === 'on-dark' ? 'text-white/70' : 'text-emerald-600',
          variant === 'on-dark' && 'text-lg font-bold sm:text-xl',
        )}
      >
        $
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label="Revenue opportunity per month"
        placeholder="0"
        value={raw}
        size={inputWidthCh}
        onChange={e => scheduleCommit(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => commit()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            inputRef.current?.blur();
          }
        }}
        style={{ width: `${inputWidthCh}ch` }}
        className={cn(
          'box-border max-w-full shrink rounded-md border font-semibold tabular-nums shadow-sm outline-none focus:ring-2',
          variant === 'on-dark' && 'px-1.5 py-0.5 text-lg font-bold sm:text-xl',
          variant === 'compact' && 'px-2 py-1 text-sm',
          variant === 'default' && 'px-2 py-1 text-sm',
          inputStyles,
          inputClassName,
        )}
      />
      {suffix ? <span className={cn('shrink-0', suffixClassName)}>{suffix}</span> : null}
      {showIcon ? (
        <Pencil
          className={cn(
            'h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            variant === 'on-dark' ? 'text-white/50' : 'text-brand-primary/50',
          )}
          aria-hidden
        />
      ) : null}
    </label>
  );
}
