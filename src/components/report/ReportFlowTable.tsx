import type { FlowPerformance } from '../../lib/types';
import { formatCurrency } from '../../lib/revenue-calculator';

type MetricStatus = 'good' | 'warning' | 'bad' | 'missing';

function metricStatus(actual: number | null, low: number, _high: number): MetricStatus {
  if (actual === null) return 'missing';
  if (actual >= low) return 'good';
  if (actual >= low * 0.7) return 'warning';
  return 'bad';
}

function TrafficLight({ status }: { status: MetricStatus }) {
  const colors: Record<MetricStatus, string> = {
    good: 'bg-emerald-500',
    warning: 'bg-amber-400',
    bad: 'bg-red-400',
    missing: 'bg-gray-200',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} shrink-0`} />;
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

function PriorityTag({ priority }: { priority: FlowPerformance['priority'] }) {
  const map: Record<FlowPerformance['priority'], { label: string; cls: string }> = {
    critical: { label: 'Critical', cls: 'text-red-600 font-bold' },
    high: { label: 'High', cls: 'text-amber-600 font-semibold' },
    medium: { label: 'Medium', cls: 'text-blue-600 font-medium' },
    low: { label: 'Low', cls: 'text-gray-400 font-medium' },
    quick_win: { label: 'Quick Win', cls: 'text-emerald-600 font-semibold' },
  };
  const { label, cls } = map[priority];
  return <span className={`text-xs ${cls}`}>{label}</span>;
}

function MetricCell({ actual, low, high, suffix = '%' }: { actual: number | null; low: number; high: number; suffix?: string }) {
  const status = metricStatus(actual, low, high);
  return (
    <td className="px-4 py-3 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <TrafficLight status={status} />
          <span className={`text-sm font-semibold tabular-nums ${
            status === 'good' ? 'text-emerald-700' :
            status === 'warning' ? 'text-amber-600' :
            status === 'bad' ? 'text-red-600' : 'text-gray-300'
          }`}>
            {actual !== null ? `${actual}${suffix}` : '—'}
          </span>
        </div>
        <span className="text-[10px] text-gray-400">{low}–{high}{suffix}</span>
      </div>
    </td>
  );
}

interface ReportFlowTableProps {
  flows: FlowPerformance[];
}

export default function ReportFlowTable({ flows }: ReportFlowTableProps) {
  const totalCurrentRevenue = flows.reduce((s, f) => s + f.monthly_revenue_current, 0);
  const totalOpportunity = flows.reduce((s, f) => s + f.monthly_revenue_opportunity, 0);

  return (
    <div>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full min-w-[900px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-48">Flow</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Open Rate
                <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">actual vs benchmark</div>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Click Rate
                <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">actual vs benchmark</div>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Conv. Rate
                <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">actual vs benchmark</div>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Opportunity
                <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">per month</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow, i) => (
              <tr
                key={flow.id}
                className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} ${
                  flow.flow_status === 'missing' ? 'opacity-75' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{flow.flow_name}</p>
                    {flow.flow_status !== 'missing' && (
                      <p className="text-xs text-gray-400 mt-0.5">{flow.recipients_per_month.toLocaleString()}/mo</p>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <FlowStatusBadge status={flow.flow_status} />
                </td>
                <td className="px-4 py-3 text-center">
                  <PriorityTag priority={flow.priority} />
                </td>
                <MetricCell
                  actual={flow.actual_open_rate}
                  low={flow.benchmark_open_rate_low}
                  high={flow.benchmark_open_rate_high}
                />
                <MetricCell
                  actual={flow.actual_click_rate}
                  low={flow.benchmark_click_rate_low}
                  high={flow.benchmark_click_rate_high}
                />
                <MetricCell
                  actual={flow.actual_conv_rate}
                  low={flow.benchmark_conv_rate_low}
                  high={flow.benchmark_conv_rate_high}
                />
                <td className="px-4 py-3 text-center">
                  {flow.monthly_revenue_opportunity > 0 ? (
                    <span className="text-sm font-bold text-emerald-700">
                      +{formatCurrency(flow.monthly_revenue_opportunity)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td colSpan={6} className="px-4 py-3 text-right">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Current Revenue</span>
                <span className="text-sm font-bold text-gray-900 ml-3">{formatCurrency(totalCurrentRevenue)}/mo</span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className="text-sm font-bold text-emerald-700">+{formatCurrency(totalOpportunity)}/mo</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 space-y-3">
        {flows.filter(f => f.notes).map(flow => (
          <div key={flow.id} className="flex gap-3 text-xs">
            <span className="font-semibold text-gray-700 shrink-0 w-36">{flow.flow_name}:</span>
            <span className="text-gray-500 leading-relaxed">{flow.notes}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
