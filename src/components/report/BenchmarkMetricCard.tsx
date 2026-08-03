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
        // shrink-0 + nowrap: the badge sits in a justify-between row beside the
        // metric label, and a flex item may shrink below its content width. With
        // a short label ("Spam Rate") there was room, but "Flow Conv. Rate"
        // squeezed the badge until "Within benchmark" wrapped onto two lines.
        // The label side can still shrink and wrap; the badge stays one line.
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none',
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
      {/* flex-wrap so the badge drops to its own line instead of the label and the
          badge fighting over the last few pixels. In the 4-across grid a card is
          about 276px, where "Flow Conv. Rate" plus the badge do not both fit:
          side by side that pushed the label onto two lines, while letting the
          badge wrap keeps the label on one line AND the badge on one line, in
          slightly less vertical space. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
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
