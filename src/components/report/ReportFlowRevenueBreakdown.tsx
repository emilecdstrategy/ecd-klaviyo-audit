import type { ReactNode } from 'react';
import type { FlowPerformance } from '../../lib/types';
import { formatCurrency, isNonRevenueFlow } from '../../lib/revenue-calculator';

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

      <div className="space-y-2.5">
        {top.map((flow, i) => {
          const pct = totalRevenue > 0 ? (flow.monthly_revenue_current / totalRevenue) * 100 : 0;
          const barWidth = maxRevenue > 0 ? (flow.monthly_revenue_current / maxRevenue) * 100 : 0;
          const isShortBar = barWidth < 22;
          return (
            <div key={flow.id} className="flex items-center gap-3">
              <div
                className="w-44 text-right text-sm text-gray-700 font-medium shrink-0 truncate"
                title={flow.flow_name}
              >
                {flow.flow_name}
              </div>
              <div className="flex-1 flex items-center gap-2 h-7">
                <div
                  className={`${BAR_COLORS[i % BAR_COLORS.length]} rounded-r-md h-full flex items-center`}
                  style={{ width: `${Math.max(barWidth, 3)}%` }}
                >
                  {!isShortBar && (
                    <span className="text-xs font-bold text-white px-2 whitespace-nowrap">
                      {formatCurrency(flow.monthly_revenue_current)}
                    </span>
                  )}
                </div>
                {isShortBar && (
                  <span className={`text-xs font-bold whitespace-nowrap ${TEXT_COLORS[i % TEXT_COLORS.length]}`}>
                    {formatCurrency(flow.monthly_revenue_current)}
                  </span>
                )}
              </div>
              <div className="w-14 text-right text-sm text-gray-500 shrink-0">
                {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}

        {rest.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="w-44 text-right text-sm text-gray-500 shrink-0">
              All Other Flows ({rest.length})
            </div>
            <div className="flex-1 flex items-center gap-2 h-7">
              {(() => {
                const restBarWidth = (restRevenue / maxRevenue) * 100;
                const isShortBar = restBarWidth < 22;
                return (
                  <>
              <div
                className="bg-gray-300 rounded-r-md h-full flex items-center"
                style={{ width: `${Math.max(restBarWidth, 3)}%` }}
              >
                {!isShortBar && (
                  <span className="text-xs font-bold text-gray-700 px-2 whitespace-nowrap">
                    {formatCurrency(restRevenue)}
                  </span>
                )}
              </div>
                  {isShortBar && (
                    <span className="text-xs font-bold text-gray-600 whitespace-nowrap">
                      {formatCurrency(restRevenue)}
                    </span>
                  )}
                  </>
                );
              })()}
            </div>
            <div className="w-14 text-right text-sm text-gray-500 shrink-0">
              {((restRevenue / totalRevenue) * 100).toFixed(1)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
