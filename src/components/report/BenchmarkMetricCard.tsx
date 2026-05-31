import type { LucideIcon } from 'lucide-react';
import type { MetricStatus } from '../../lib/benchmarks';
import {
  formatStatusBadgeLabel,
  metricStatusStyles,
  type BenchmarkDirection,
} from '../../lib/benchmark-ui';
import { cn } from '../../lib/utils';

export function BenchmarkStatusBadge({
  status,
  direction,
}: {
  status: MetricStatus;
  direction: BenchmarkDirection;
}) {
  const label = formatStatusBadgeLabel(status, direction);
  if (!label) return null;
  const styles = metricStatusStyles(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none',
        styles.badge,
      )}
    >
      {label}
    </span>
  );
}

export function BenchmarkMetricCard({
  label,
  value,
  contextLine,
  benchmarkLine,
  status = 'missing',
  direction = 'higher',
  icon: Icon,
}: {
  label: string;
  value: string;
  contextLine: string;
  benchmarkLine?: string;
  status?: MetricStatus;
  direction?: BenchmarkDirection;
  icon?: LucideIcon;
}) {
  const styles = metricStatusStyles(status);

  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', styles.chip)}>
              <Icon className={cn('h-3.5 w-3.5 shrink-0', styles.icon)} strokeWidth={2} />
            </div>
          ) : null}
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
        </div>
        {status !== 'missing' ? (
          <BenchmarkStatusBadge status={status} direction={direction} />
        ) : null}
      </div>
      <p className={cn('text-2xl font-bold tabular-nums tracking-tight', styles.value)}>{value}</p>
      <div className="mt-1.5 space-y-1">
        <p className="text-xs leading-snug text-gray-500">{contextLine}</p>
        {benchmarkLine ? (
          <p className="text-xs leading-snug text-gray-400">{benchmarkLine}</p>
        ) : null}
      </div>
    </div>
  );
}
