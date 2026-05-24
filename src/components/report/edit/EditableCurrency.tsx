import { useEffect, useRef, useState } from 'react';
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
};

function parseCurrencyInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export default function EditableCurrency({
  value,
  onSave,
  className,
  inputClassName,
  suffix,
  suffixClassName,
}: EditableCurrencyProps) {
  const { editMode } = useReportEdit();
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setRaw(value ? String(value) : '');
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [value, editing]);

  const canEdit = editMode && Boolean(onSave);

  const commit = () => {
    setEditing(false);
    const next = parseCurrencyInput(raw);
    if (next !== value) onSave?.(next);
    setRaw(next ? String(next) : '');
  };

  if (!canEdit) {
    return (
      <span className={className}>
        {formatCurrency(value || 0)}
        {suffix ? <span className={suffixClassName}>{suffix}</span> : null}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          className,
          'cursor-text rounded text-left transition-shadow',
          'hover:ring-1 hover:ring-brand-primary/20 hover:ring-offset-1',
          'focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:ring-offset-1',
        )}
      >
        {formatCurrency(value || 0)}
        {suffix ? <span className={suffixClassName}>{suffix}</span> : null}
      </button>
    );
  }

  return (
    <span className={cn('inline-flex items-baseline gap-0.5', className)}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={e => setRaw(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            setRaw(value ? String(value) : '');
            setEditing(false);
          }
        }}
        className={cn(
          'min-w-[5rem] bg-transparent outline-none border-b border-current/30 focus:border-current/60 tabular-nums',
          inputClassName,
        )}
      />
      {suffix ? <span className={suffixClassName}>{suffix}</span> : null}
    </span>
  );
}
