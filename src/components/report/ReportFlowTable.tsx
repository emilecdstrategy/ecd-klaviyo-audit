import type { FlowPerformance, KlaviyoFlowSnapshot } from '../../lib/types';
import { formatCurrency } from '../../lib/revenue-calculator';
import { useRef, useState, useLayoutEffect, useCallback, type MouseEvent } from 'react';
import { cn } from '../../lib/utils';

type MetricStatus = 'good' | 'warning' | 'bad' | 'missing';

function metricStatus(actual: number | null, low: number, _high: number): MetricStatus {
  if (actual === null) return 'missing';
  if (actual >= low) return 'good';
  if (actual >= low * 0.7) return 'warning';
  return 'bad';
}

function overallRating(flow: FlowPerformance): MetricStatus {
  const scores = [
    metricStatus(flow.actual_open_rate, flow.benchmark_open_rate_low, flow.benchmark_open_rate_high),
    metricStatus(flow.actual_click_rate, flow.benchmark_click_rate_low, flow.benchmark_click_rate_high),
    metricStatus(flow.actual_conv_rate, flow.benchmark_conv_rate_low, flow.benchmark_conv_rate_high),
  ];
  const bad = scores.filter(s => s === 'bad').length;
  const good = scores.filter(s => s === 'good').length;
  if (bad >= 2) return 'bad';
  if (good >= 2) return 'good';
  return 'warning';
}

function buildAssessment(flow: FlowPerformance): string {
  const parts: string[] = [];
  const openStatus = metricStatus(flow.actual_open_rate, flow.benchmark_open_rate_low, flow.benchmark_open_rate_high);
  const clickStatus = metricStatus(flow.actual_click_rate, flow.benchmark_click_rate_low, flow.benchmark_click_rate_high);
  const convStatus = metricStatus(flow.actual_conv_rate, flow.benchmark_conv_rate_low, flow.benchmark_conv_rate_high);

  if (openStatus === 'bad' && flow.actual_open_rate !== null) {
    parts.push(`Open rate ${(flow.actual_open_rate * 100).toFixed(1)}% below ${(flow.benchmark_open_rate_low * 100).toFixed(0)}-${(flow.benchmark_open_rate_high * 100).toFixed(0)}% benchmark`);
  }
  if (clickStatus === 'bad' && flow.actual_click_rate !== null) {
    parts.push(`Click ${(flow.actual_click_rate * 100).toFixed(1)}% vs. ${(flow.benchmark_click_rate_low * 100).toFixed(0)}-${(flow.benchmark_click_rate_high * 100).toFixed(0)}% benchmark`);
  }
  if (convStatus === 'bad' && flow.actual_conv_rate !== null) {
    parts.push(`Conv ${(flow.actual_conv_rate * 100).toFixed(2)}% vs. ${(flow.benchmark_conv_rate_low * 100).toFixed(1)}-${(flow.benchmark_conv_rate_high * 100).toFixed(0)}% benchmark`);
  }

  const rpr = flow.recipients_per_month > 0 ? flow.monthly_revenue_current / flow.recipients_per_month : 0;
  if (flow.recipients_per_month > 50_000 && rpr < 0.02) {
    parts.push(`Massive volume, tiny conversion. ${flow.recipients_per_month.toLocaleString()} recipients for ${formatCurrency(flow.monthly_revenue_current)}`);
  }

  if (parts.length === 0) {
    const rating = overallRating(flow);
    if (rating === 'good') return 'Performing well relative to benchmarks.';
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
  const status = metricStatus(actual, low, high);
  const colorMap: Record<MetricStatus, string> = {
    good: 'text-emerald-700',
    warning: 'text-amber-600',
    bad: 'text-red-600',
    missing: 'text-gray-300',
  };
  return (
    <span className={`text-sm font-semibold tabular-nums ${colorMap[status]}`}>
      {actual !== null ? `${(actual * 100).toFixed(actual < 0.01 ? 2 : 1)}%` : '—'}
    </span>
  );
}

interface ReportFlowTableProps {
  flows: FlowPerformance[];
  snapshots?: KlaviyoFlowSnapshot[];
}

export default function ReportFlowTable({ flows, snapshots }: ReportFlowTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ isDown: boolean; startX: number; startScrollLeft: number }>({
    isDown: false,
    startX: 0,
    startScrollLeft: 0,
  });
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const sorted = [...flows].sort((a, b) => b.monthly_revenue_current - a.monthly_revenue_current);

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
  }, [updateOverflow, sorted.length, flows.length]);

  const snapshotMap = new Map<string, KlaviyoFlowSnapshot>();
  if (snapshots) {
    for (const s of snapshots) {
      snapshotMap.set(s.name, s);
    }
  }

  const totalRecipients = sorted.reduce((s, f) => s + f.recipients_per_month, 0);
  const totalRevenue = sorted.reduce((s, f) => s + f.monthly_revenue_current, 0);

  const revenueGenerators = sorted.filter(f => f.monthly_revenue_current > 0);
  const subtitle = `${revenueGenerators.length} flows generating ${totalRevenue > 0 ? ((revenueGenerators.reduce((s, f) => s + f.monthly_revenue_current, 0) / totalRevenue) * 100).toFixed(1) : 0}% of total flow revenue.`;

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
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>
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
              {sorted.map((flow) => {
                const snap = snapshotMap.get(flow.flow_name);
                const actionCount = snap?.raw?.attributes?.action_count ?? snap?.raw?.relationships?.flow_actions?.data?.length ?? null;
                const rpr = flow.recipients_per_month > 0 ? flow.monthly_revenue_current / flow.recipients_per_month : 0;
                const rating = overallRating(flow);
                const assessment = buildAssessment(flow);

                return (
                  <tr
                    key={flow.id}
                    className={cn(
                      'transition-colors hover:bg-gray-50/50',
                      flow.flow_status === 'missing' && 'opacity-75',
                    )}
                  >
                    <td className="py-4 pl-6 pr-4">
                      <p className="text-sm font-medium text-gray-900 leading-tight">{flow.flow_name}</p>
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
                      {pctCell(flow.actual_open_rate, flow.benchmark_open_rate_low, flow.benchmark_open_rate_high)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {pctCell(flow.actual_click_rate, flow.benchmark_click_rate_low, flow.benchmark_click_rate_high)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {pctCell(flow.actual_conv_rate, flow.benchmark_conv_rate_low, flow.benchmark_conv_rate_high)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(flow.monthly_revenue_current)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-gray-600">
                      ${rpr.toFixed(2)}
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
      </div>
    </div>
  );
}
