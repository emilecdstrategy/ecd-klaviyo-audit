import type { ReactNode } from 'react';
import type { FlowPerformance } from '../../lib/types';
import { formatCurrency } from '../../lib/revenue-calculator';
import { getFlowRevenueMixTarget } from '../../lib/benchmarks';
import { usePlatformSettings } from '../../contexts/PlatformSettingsContext';

import type { RevenueBreakdown } from '../../lib/revenue-breakdown';
import { formatStoreRevenueContext } from '../../lib/revenue-breakdown';

interface Props {
  performance: FlowPerformance[];
  title?: ReactNode;
  revenueBreakdown?: RevenueBreakdown | null;
}

const BAR_COLORS = [
  'bg-blue-600',
  'bg-emerald-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-lime-600',
];

const TEXT_COLORS = [
  'text-blue-700',
  'text-emerald-600',
  'text-purple-600',
  'text-amber-600',
  'text-teal-600',
  'text-orange-600',
  'text-indigo-600',
  'text-pink-600',
  'text-cyan-600',
  'text-lime-700',
];

export default function ReportFlowRevenueBreakdown({ performance, title, revenueBreakdown }: Props) {
  const { benchmarks } = usePlatformSettings();
  const visiblePerformance = performance.filter(f => !f.is_hidden);
  const sorted = [...visiblePerformance].sort((a, b) => b.monthly_revenue_current - a.monthly_revenue_current);
  const totalRevenue = sorted.reduce((s, f) => s + f.monthly_revenue_current, 0);
  if (totalRevenue <= 0) return null;

  const storeContext = formatStoreRevenueContext(
    totalRevenue,
    revenueBreakdown?.total_store_revenue,
    revenueBreakdown?.attributed_revenue,
  );

  const topN = 10;
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restRevenue = rest.reduce((s, f) => s + f.monthly_revenue_current, 0);
  const topRevenue = top.reduce((s, f) => s + f.monthly_revenue_current, 0);
  const maxRevenue = top[0]?.monthly_revenue_current ?? 1;

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-1">{title ?? 'Revenue Breakdown by Flow'}</h3>
      <p className="text-sm text-gray-500 mb-5">
        Top {top.length} revenue-generating flows account for{' '}
        <span className="font-semibold text-gray-800">{formatCurrency(topRevenue)}</span>{' '}
        ({totalRevenue > 0 ? ((topRevenue / totalRevenue) * 100).toFixed(1) : 0}%) of total{' '}
        {formatCurrency(totalRevenue)} flow revenue
        {storeContext ? (
          <span className="text-gray-600"> · {storeContext}</span>
        ) : null}
        .
      </p>

      <div className="space-y-2">
        {top.map((flow, i) => {
          const pct = totalRevenue > 0 ? (flow.monthly_revenue_current / totalRevenue) * 100 : 0;
          const barWidth = maxRevenue > 0 ? (flow.monthly_revenue_current / maxRevenue) * 100 : 0;
          const isShortBar = barWidth < 28;
          const mixTarget = getFlowRevenueMixTarget(flow.flow_name, benchmarks);
          const targetPct = mixTarget != null ? mixTarget * 100 : null;
          const meetsTarget = targetPct != null && pct >= targetPct;
          return (
            <div key={flow.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
              <div
                className="max-w-[11rem] min-w-0 truncate text-right text-sm font-medium text-gray-700"
                title={flow.flow_name}
              >
                {flow.flow_name}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-gray-100">
                  <div
                    className={`absolute inset-y-0 left-0 ${BAR_COLORS[i % BAR_COLORS.length]} flex items-center rounded-r-md`}
                    style={{ width: `${Math.max(barWidth, flow.monthly_revenue_current > 0 ? 2 : 0)}%` }}
                  >
                    {!isShortBar && (
                      <span className="text-[11px] font-bold text-white px-1.5 whitespace-nowrap">
                        {formatCurrency(flow.monthly_revenue_current)}
                      </span>
                    )}
                  </div>
                </div>
                {isShortBar && (
                  <span className={`shrink-0 text-[11px] font-bold whitespace-nowrap ${TEXT_COLORS[i % TEXT_COLORS.length]}`}>
                    {formatCurrency(flow.monthly_revenue_current)}
                  </span>
                )}
              </div>
              <div className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">
                <span className="text-gray-500">{pct.toFixed(1)}%</span>
                {targetPct != null ? (
                  <span className={`ml-1 text-xs ${meetsTarget ? 'text-emerald-600' : 'text-amber-600'}`}>
                    · target {targetPct.toFixed(targetPct < 1 ? 2 : 1)}%
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {rest.length > 0 && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
            <div className="max-w-[11rem] min-w-0 truncate text-right text-sm text-gray-500">
              All Other Flows ({rest.length})
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {(() => {
                const restBarWidth = (restRevenue / maxRevenue) * 100;
                const isShortBar = restBarWidth < 28;
                return (
                  <>
                    <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-gray-100">
                      <div
                        className="absolute inset-y-0 left-0 flex items-center rounded-r-md bg-gray-300"
                        style={{ width: `${Math.max(restBarWidth, restRevenue > 0 ? 2 : 0)}%` }}
                      >
                        {!isShortBar && (
                          <span className="text-[11px] font-bold text-gray-700 px-1.5 whitespace-nowrap">
                            {formatCurrency(restRevenue)}
                          </span>
                        )}
                      </div>
                    </div>
                    {isShortBar && (
                      <span className="shrink-0 text-[11px] font-bold text-gray-600 whitespace-nowrap">
                        {formatCurrency(restRevenue)}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-gray-500">
              {((restRevenue / totalRevenue) * 100).toFixed(1)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
