import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { formatCurrency } from '../../../lib/revenue-calculator';
import { useProposalEdit } from './ProposalEditContext';

type ProposalCurrencyProps = {
  value: number | null;
  onSave?: (value: number | null) => void;
  className?: string;
  ariaLabel: string;
  /** Shown read-only when there is no numeric value (e.g. a pricing label). */
  fallback?: string | null;
};

function parseCurrencyInput(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Currency input for proposal line items; empty means "no price of this unit". */
export default function ProposalCurrency({
  value,
  onSave,
  className,
  ariaLabel,
  fallback,
}: ProposalCurrencyProps) {
  const { editMode } = useProposalEdit();
  const [raw, setRaw] = useState(value ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setRaw(value ? String(value) : '');
  }, [value]);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

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

  if (!canEdit) {
    return (
      <span className={cn('tabular-nums', className)}>
        {value ? formatCurrency(value) : fallback || '—'}
      </span>
    );
  }

  const widthCh = Math.max(4, (raw || '0').length + 2);

  return (
    <label className={cn('inline-flex items-center gap-0.5', className)}>
      <span className="shrink-0 text-gray-400">$</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder="—"
        value={raw}
        onChange={e => scheduleCommit(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => commit()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            inputRef.current?.blur();
          }
        }}
        style={{ width: `${widthCh}ch` }}
        className="box-border rounded-md border border-brand-primary/30 bg-white px-1.5 py-0.5 text-right tabular-nums shadow-sm outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
      />
    </label>
  );
}
