import type { FlowPerformance, KlaviyoFlowSnapshot } from '../../lib/types';
import { formatCurrency } from '../../lib/revenue-calculator';
import { AlertTriangle } from 'lucide-react';

interface Props {
  snapshots: KlaviyoFlowSnapshot[];
  performance: FlowPerformance[];
  clientName?: string;
}

export default function ReportFlowStats({ snapshots, performance, clientName }: Props) {
  const total = snapshots.length;
  const live = snapshots.filter(f => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const draftPaused = snapshots.filter(f => ['draft', 'paused'].includes(f.status?.toLowerCase())).length;
  const manual = snapshots.filter(f => f.status?.toLowerCase() === 'manual' || f.trigger_type === 'Unconfigured').length;

  const hasPerf = performance.length > 0;
  const annualRevenue = performance.reduce((s, f) => s + f.monthly_revenue_current, 0) * 12;
  const totalRecipients = performance.reduce((s, f) => s + f.recipients_per_month, 0);
  const weightedConv = totalRecipients > 0
    ? performance.reduce((s, f) => s + (f.actual_conv_rate ?? 0) * f.recipients_per_month, 0) / totalRecipients
    : 0;
  const rpr = totalRecipients > 0 ? (annualRevenue / 12) / totalRecipients : 0;

  const fmtRecipients = hasPerf
    ? (totalRecipients >= 1_000_000 ? `${(totalRecipients / 1_000_000).toFixed(2)}M` : totalRecipients >= 1_000 ? `${(totalRecipients / 1_000).toFixed(0)}K` : String(totalRecipients))
    : '—';

  const inactivePercent = total > 0 ? Math.round((draftPaused / total) * 100) : 0;
  const monthlyRevenue = annualRevenue / 12;

  const stats = [
    { label: 'Total Flows', value: String(total), sub: 'in Klaviyo account' },
    { label: 'Live Flows', value: String(live), sub: 'actively sending' },
    { label: 'Draft / Paused', value: String(draftPaused), sub: `${inactivePercent}% inactive` },
    { label: 'Manual Flows', value: String(manual), sub: 'require manual trigger' },
    { label: 'Annual Flow Revenue', value: hasPerf ? formatCurrency(annualRevenue) : 'N/A', sub: hasPerf ? `${formatCurrency(monthlyRevenue)}/mo` : 'requires Klaviyo metrics scope', subColor: hasPerf ? 'text-emerald-600' : undefined },
    { label: 'Total Recipients', value: hasPerf ? fmtRecipients : 'N/A', sub: hasPerf ? 'per month' : 'requires Klaviyo metrics scope' },
    { label: 'Overall Conv. Rate', value: hasPerf ? `${(weightedConv * 100).toFixed(2)}%` : 'N/A', sub: hasPerf ? 'weighted average' : 'requires Klaviyo metrics scope' },
    { label: 'Revenue Per Recipient', value: hasPerf ? `$${rpr.toFixed(2)}` : 'N/A', sub: hasPerf ? 'across all flows' : 'requires Klaviyo metrics scope' },
  ];

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-4">Executive Summary</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className={`text-xs font-medium mt-0.5 ${s.subColor ?? 'text-gray-400'}`}>{s.sub}</p>
          </div>
        ))}
      </div>

      {hasPerf && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-800 leading-relaxed">
            <span className="font-bold">Bottom Line:</span>{' '}
            {formatCurrency(annualRevenue)}/year from flows
            {annualRevenue < 100_000
              ? ' is significantly below benchmark'
              : annualRevenue < 250_000
              ? ' is below typical performance'
              : ' shows a solid foundation'}
            {clientName ? ` for ${clientName}` : ''}.
            {inactivePercent > 30 && ` Nearly ${inactivePercent}% of flows are inactive.`}
            {weightedConv < 0.02 && ` Conversion rates are below industry benchmarks.`}
            {monthlyRevenue > 0 && rpr < 0.10 && ` Revenue per recipient ($${rpr.toFixed(2)}) indicates optimization opportunities.`}
          </p>
        </div>
      )}
    </div>
  );
}
