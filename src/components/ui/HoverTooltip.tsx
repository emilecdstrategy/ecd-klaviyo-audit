import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type HoverTooltipProps = {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
};

export default function HoverTooltip({
  label,
  description,
  children,
  className,
  align = 'center',
}: HoverTooltipProps) {
  return (
    <span className={cn('group/tooltip relative inline-flex max-w-full', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full z-50 mb-1.5 w-max max-w-[18rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-left shadow-lg ring-1 ring-black/5',
          'opacity-0 transition-opacity duration-75 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          align === 'start' && 'left-0',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'end' && 'right-0',
        )}
      >
        <span className="block text-xs font-semibold leading-snug text-gray-900">{label}</span>
        {description ? (
          <span className="mt-1 block whitespace-pre-wrap text-[11px] leading-snug text-gray-600">
            {description}
          </span>
        ) : null}
      </span>
    </span>
  );
}
