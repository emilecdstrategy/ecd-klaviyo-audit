import type { FlowPerformance, KlaviyoFlowSnapshot } from '../../lib/types';
import { formatCurrency, isNonRevenueFlow } from '../../lib/revenue-calculator';
import {
  classifyRate,
  formatBenchmarkRange,
  formatHealthyLabel,
  formatPctDecimal,
  getFlowBenchmarks,
  OPEN_RATE_BENCHMARK,
  CLICK_RATE_BENCHMARK,
  RECOVERY_CONV_BENCHMARK,
  STANDARD_CONV_BENCHMARK,
  type MetricStatus,
} from '../../lib/benchmarks';
import { useRef, useState, useLayoutEffect, useCallback, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

const DEFAULT_VISIBLE_FLOWS = 2;

export type { MetricStatus };

function overallRating(flow: FlowPerformance): MetricStatus {
  const b = getFlowBenchmarks(flow.flow_name);
  const scores = [
    classifyRate(flow.actual_open_rate, b.openRateLow, b.openRateHigh),
    classifyRate(flow.actual_click_rate, b.clickRateLow, b.clickRateHigh),
    ...(b.convApplicable ? [classifyRate(flow.actual_conv_rate, b.convRateLow, b.convRateHigh)] : []),
  ];
  const bad = scores.filter(s => s === 'bad').length;
  const good = scores.filter(s => s === 'good').length;
  if (bad >= 2) return 'bad';
  if (good >= 2) return 'good';
  if (!b.convApplicable && good >= 1) return 'good';
  return 'warning';
}

function buildAssessment(flow: FlowPerformance): string {
  const b = getFlowBenchmarks(flow.flow_name);
  const parts: string[] = [];
  const openStatus = classifyRate(flow.actual_open_rate, b.openRateLow, b.openRateHigh);
  const clickStatus = classifyRate(flow.actual_click_rate, b.clickRateLow, b.clickRateHigh);

  const describeMetric = (
    label: string,
    actual: number | null,
    low: number,
    high: number,
    status: MetricStatus,
  ) => {
    if (actual === null) return;
    const actualStr = formatPctDecimal(actual);
    const rangeStr = formatBenchmarkRange(low, high);
    if (status === 'good') {
      parts.push(`${label} ${actualStr} (${formatHealthyLabel(status)} vs ${rangeStr})`);
    } else if (status === 'warning' || status === 'bad') {
      parts.push(`${label} ${actualStr} below ${rangeStr} benchmark`);
    }
  };

  describeMetric('Open', flow.actual_open_rate, b.openRateLow, b.openRateHigh, openStatus);
  describeMetric('Click', flow.actual_click_rate, b.clickRateLow, b.clickRateHigh, clickStatus);

  if (b.convApplicable) {
    const convStatus = classifyRate(flow.actual_conv_rate, b.convRateLow, b.convRateHigh);
    describeMetric('Conv', flow.actual_conv_rate, b.convRateLow, b.convRateHigh, convStatus);

    const rpr = flow.recipients_per_month > 0 ? flow.monthly_revenue_current / flow.recipients_per_month : 0;
    if (flow.recipients_per_month > 50_000 && rpr < 0.02) {
      parts.push(`Massive volume, tiny conversion. ${flow.recipients_per_month.toLocaleString()} recipients for ${formatCurrency(flow.monthly_revenue_current)}`);
    }
  }

  if (parts.length === 0) {
    if (!b.convApplicable) return 'Non-revenue flow. Engagement metrics look healthy.';
    const rating = overallRating(flow);
    if (rating === 'good') {
      return `Performing within healthy ranges for a ${b.tierLabel} (open ${formatBenchmarkRange(b.openRateLow, b.openRateHigh)}, click ${formatBenchmarkRange(b.clickRateLow, b.clickRateHigh)}, conv ${formatBenchmarkRange(b.convRateLow, b.convRateHigh)}).`;
    }
    return 'Moderate performance, room for improvement.';
  }

  return parts.slice(0, 2).join('. ') + '.';
}

function RatingDot({ status }: { status: MetricStatus }) {
  const colors: Record<MetricStatus, string> = {
    good: 'bg-emerald-500',
    warning: 'bg-amber-400',
    bad: 'bg-red-400',
    missing: 'bg-gray-200',
  };
  return <span className={`inline-block w-3 h-3 rounded-full ${colors[status]}`} />;
}

function FlowStatusBadge({ status }: { status: FlowPerformance['flow_status'] }) {
  const map: Record<FlowPerformance['flow_status'], { label: string; cls: string }> = {
    live: { label: 'Live', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    draft: { label: 'Draft', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
    missing: { label: 'Missing', cls: 'bg-red-50 text-red-700 border border-red-200' },
    paused: { label: 'Paused', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
  };
  const { label, cls } = map[status];
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function pctCell(actual: number | null, low: number, high: number) {
  const status = classifyRate(actual, low, high);
  const colorMap: Record<MetricStatus, string> = {
    good: 'text-emerald-700',
    warning: 'text-amber-600',
    bad: 'text-red-600',
    missing: 'text-gray-300',
  };
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-semibold tabular-nums ${colorMap[status]}`}>
        {actual !== null ? formatPctDecimal(actual) : '—'}
      </span>
      {low > 0 || high > 0 ? (
        <span className="text-[10px] leading-tight text-gray-400 tabular-nums">
          vs {formatBenchmarkRange(low, high)}
        </span>
      ) : null}
    </div>
  );
}

interface ReportFlowTableProps {
  flows: FlowPerformance[];
  snapshots?: KlaviyoFlowSnapshot[];
  defaultVisibleRows?: number;
  subtitleOverride?: string;
}

export default function ReportFlowTable({ flows, snapshots, defaultVisibleRows, subtitleOverride }: ReportFlowTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ isDown: boolean; startX: number; startScrollLeft: number }>({
    isDown: false,
    startX: 0,
    startScrollLeft: 0,
  });
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const visibleRowLimit = Math.max(1, defaultVisibleRows ?? DEFAULT_VISIBLE_FLOWS);
  const filtered = flows.filter(f => !f.is_hidden);
  const sorted = [...filtered].sort((a, b) => {
    if (typeof a.display_order === 'number' && typeof b.display_order === 'number') {
      return a.display_order - b.display_order;
    }
    return b.monthly_revenue_current - a.monthly_revenue_current;
  });
  const hasMore = sorted.length > visibleRowLimit;
  const visible = expanded || !hasMore ? sorted : sorted.slice(0, visibleRowLimit);
  const hiddenCount = sorted.length - visible.length;

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHasHorizontalOverflow(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    updateOverflow();
    const id = requestAnimationFrame(() => updateOverflow());
    const el = scrollRef.current;
    if (!el) {
      return () => cancelAnimationFrame(id);
    }
    const ro = new ResizeObserver(() => updateOverflow());
    ro.observe(el);
    window.addEventListener('resize', updateOverflow);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [updateOverflow, sorted.length, flows.length, expanded]);

  const snapshotMap = new Map<string, KlaviyoFlowSnapshot>();
  if (snapshots) {
    for (const s of snapshots) {
      snapshotMap.set(s.name, s);
    }
  }

  const totalRecipients = sorted.reduce((s, f) => s + f.recipients_per_month, 0);
  const totalRevenue = sorted.reduce((s, f) => s + f.monthly_revenue_current, 0);

  const revenueGenerators = sorted.filter(f => f.monthly_revenue_current > 0);
  const computedSubtitle = `${revenueGenerators.length} flows generating ${totalRevenue > 0 ? ((revenueGenerators.reduce((s, f) => s + f.monthly_revenue_current, 0) / totalRevenue) * 100).toFixed(1) : 0}% of total flow revenue.`;
  const subtitle = subtitleOverride || computedSubtitle;

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!hasHorizontalOverflow) return;
    const el = scrollRef.current;
    if (!el) return;
    dragStateRef.current = {
      isDown: true,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!hasHorizontalOverflow) return;
    const el = scrollRef.current;
    const drag = dragStateRef.current;
    if (!el || !drag.isDown) return;
    const deltaX = e.clientX - drag.startX;
    el.scrollLeft = drag.startScrollLeft - deltaX;
  };

  const stopDragging = () => {
    dragStateRef.current.isDown = false;
  };

  const thClass = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide first:pl-6 last:pr-6';

  return (
    <div>
      <p className="text-sm text-gray-500 mb-2">{subtitle}</p>
      <p className="text-xs text-gray-400 mb-4">
        Percentages shown against ECD Klaviyo healthy benchmark ranges — open{' '}
        {formatBenchmarkRange(OPEN_RATE_BENCHMARK.low, OPEN_RATE_BENCHMARK.high)}, click{' '}
        {formatBenchmarkRange(CLICK_RATE_BENCHMARK.low, CLICK_RATE_BENCHMARK.high)}, conversion{' '}
        {formatBenchmarkRange(RECOVERY_CONV_BENCHMARK.low, RECOVERY_CONV_BENCHMARK.high)} (recovery) or{' '}
        {formatBenchmarkRange(STANDARD_CONV_BENCHMARK.low, STANDARD_CONV_BENCHMARK.high)} (other revenue flows).
      </p>
      <div className="rounded-xl card-shadow overflow-hidden border border-gray-100 bg-white">
        <div
          ref={scrollRef}
          className={cn(
            'overflow-x-auto',
            hasHorizontalOverflow && 'cursor-grab active:cursor-grabbing select-none',
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
        >
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className={`${thClass} text-left`}>Flow</th>
                <th className={`${thClass} text-center w-16`}>Status</th>
                <th className={`${thClass} text-right w-24`}>Recipients</th>
                <th className={`${thClass} text-center w-16`}>Actions</th>
                <th className={`${thClass} text-center w-20`}>Open Rate</th>
                <th className={`${thClass} text-center w-20`}>Click Rate</th>
                <th className={`${thClass} text-center w-20`}>Conv Rate</th>
                <th className={`${thClass} text-right w-20`}>Revenue</th>
                <th className={`${thClass} text-right w-16`}>RPR</th>
                <th className={`${thClass} text-center w-14`}>Rating</th>
                <th className={`${thClass} text-left min-w-[200px]`}>Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map((flow) => {
                const snap = snapshotMap.get(flow.flow_name);
                const actionCount =
                  snap?.action_count
                  ?? (Array.isArray(snap?.flow_actions) ? snap.flow_actions.length : null);
                const rpr = flow.recipients_per_month > 0 ? flow.monthly_revenue_current / flow.recipients_per_month : 0;
                const rating: MetricStatus = (flow.display_rating as MetricStatus | null | undefined) ?? overallRating(flow);
                const assessment = flow.display_assessment ?? buildAssessment(flow);
                const displayName = flow.display_name ?? flow.flow_name;
                const nonRevenue = isNonRevenueFlow(flow.flow_name);
                const flowBenchmarks = getFlowBenchmarks(flow.flow_name);

                return (
                  <tr
                    key={flow.id}
                    className={cn(
                      'transition-colors hover:bg-gray-50/50',
                      flow.flow_status === 'missing' && 'opacity-75',
                    )}
                  >
                    <td className="py-4 pl-6 pr-4">
                      <p className="text-sm font-medium text-gray-900 leading-tight">{displayName}</p>
                      {nonRevenue && (
                        <span className="inline-block mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                          Engagement only
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <FlowStatusBadge status={flow.flow_status} />
                    </td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-700">
                      {flow.recipients_per_month.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-center text-sm tabular-nums text-gray-600">
                      {actionCount ?? '—'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {pctCell(flow.actual_open_rate, flowBenchmarks.openRateLow, flowBenchmarks.openRateHigh)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {pctCell(flow.actual_click_rate, flowBenchmarks.clickRateLow, flowBenchmarks.clickRateHigh)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {nonRevenue
                        ? <span className="text-sm text-gray-300">N/A</span>
                        : pctCell(flow.actual_conv_rate, flowBenchmarks.convRateLow, flowBenchmarks.convRateHigh)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-900">
                      {nonRevenue
                        ? <span className="text-gray-300">—</span>
                        : <span className="font-semibold">{formatCurrency(flow.monthly_revenue_current)}</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-600">
                      {nonRevenue ? <span className="text-gray-300">—</span> : `$${rpr.toFixed(2)}`}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <RatingDot status={rating} />
                    </td>
                    <td className="py-4 pl-4 pr-6">
                      <p className={`text-xs leading-relaxed ${rating === 'bad' ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                        {assessment}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100 bg-gray-50/80 font-semibold">
                <td className="px-4 py-4 pl-6 text-sm text-gray-700">Totals</td>
                <td />
                <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-700">{totalRecipients.toLocaleString()}</td>
                <td />
                <td />
                <td />
                <td />
                <td className="px-4 py-4 text-right text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(totalRevenue)}</td>
                <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-600">
                  ${totalRecipients > 0 ? (totalRevenue / totalRecipients).toFixed(2) : '0.00'}
                </td>
                <td />
                <td className="pr-6" />
              </tr>
            </tfoot>
          </table>
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-sm font-medium text-brand-primary hover:bg-gray-50 border-t border-gray-100 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Show all {sorted.length} flows
                <span className="text-gray-400 font-normal">({hiddenCount} hidden)</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
