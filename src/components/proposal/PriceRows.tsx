import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

/** Dotted-leader line item row — same visual language as the report Investment Summary. */
export function MenuPriceRow({
  label,
  amount,
  caption,
  labelClassName,
}: {
  label: ReactNode;
  amount: ReactNode;
  caption?: string;
  labelClassName?: string;
}) {
  return (
    <div className="py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={cn('max-w-[58%] shrink-0 text-base font-medium leading-snug text-gray-900', labelClassName)}>
          {label}
        </span>
        <span
          className="min-w-[1.5rem] flex-1 translate-y-[-0.15em] border-b border-dotted border-gray-300"
          aria-hidden
        />
        <span className="shrink-0 text-right text-base font-semibold tabular-nums text-gray-900">
          {amount}
        </span>
      </div>
      {caption ? <p className="mt-0.5 text-right text-xs text-gray-500">{caption}</p> : null}
    </div>
  );
}

export function SummaryTotalRow({
  label,
  amount,
  suffix,
  emphasis = false,
  tone = 'default',
}: {
  label: string;
  amount: string;
  suffix?: string;
  emphasis?: boolean;
  tone?: 'default' | 'discount';
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline gap-2', emphasis ? 'py-1' : 'py-1.5')}>
      <span
        className={cn(
          'shrink-0',
          emphasis ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold',
          tone === 'discount' ? 'text-emerald-700' : emphasis ? '' : 'text-gray-700',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'min-w-[1.5rem] flex-1 translate-y-[-0.12em] border-b border-dotted',
          emphasis ? 'border-gray-400' : 'border-gray-300',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'shrink-0 text-right tabular-nums',
          emphasis ? 'text-xl font-extrabold tracking-tight text-gray-900' : 'text-sm font-semibold',
          tone === 'discount' ? 'text-emerald-700' : emphasis ? '' : 'text-gray-900',
        )}
      >
        {amount}
        {suffix ? (
          <span className={cn('ml-1 font-medium text-gray-500', emphasis ? 'text-sm' : 'text-xs')}>
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}
