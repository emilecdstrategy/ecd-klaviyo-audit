import type { FlowPerformance, KlaviyoFlowSnapshot } from '../../lib/types';
import { formatCurrency } from '../../lib/revenue-calculator';
import { AlertTriangle } from 'lucide-react';

interface Props {
  snapshots: KlaviyoFlowSnapshot[];
  performance: FlowPerformance[];
  clientName?: string;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
      <p className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

export default function ReportFlowStats({ snapshots, performance, clientName }: Props) {
  const total = snapshots.length;
  const live = snapshots.filter(f => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const draftPaused = snapshots.filter(f => ['draft', 'paused'].includes(f.status?.toLowerCase())).length;
  const manual = snapshots.filter(f => f.status?.toLowerCase() === 'manual' || f.trigger_type === 'Unconfigured').length;

  const annualRevenue = performance.reduce((s, f) => s + f.monthly_revenue_current, 0) * 12;
  const totalRecipients = performance.reduce((s, f) => s + f.recipients_per_month, 0);

  const weightedConv = totalRecipients > 0
    ? performance.reduce((s, f) => s + (f.actual_conv_rate ?? 0) * f.recipients_per_month, 0) / totalRecipients
    : 0;
  const rpr = totalRecipients > 0 ? (annualRevenue / 12) / totalRecipients : 0;

  const topColors = [
    'border-l-4 border-l-blue-500',
    'border-l-4 border-l-emerald-500',
    'border-l-4 border-l-amber-500',
    'border-l-4 border-l-purple-500',
  ];

  const bottomColors = [
    'border-l-4 border-l-blue-500',
    'border-l-4 border-l-emerald-500',
    'border-l-4 border-l-amber-500',
    'border-l-4 border-l-red-400',
  ];

  const topRow = [
    { label: 'Total Flows', value: String(total) },
    { label: 'Live Flows', value: String(live) },
    { label: 'Draft / Paused', value: String(draftPaused) },
    { label: 'Manual Flows', value: String(manual) },
  ];

  const bottomRow = [
    { label: 'Annual Flow Revenue', value: formatCurrency(annualRevenue), accent: 'text-blue-700' },
    { label: 'Total Recipients', value: totalRecipients >= 1_000_000 ? `${(totalRecipients / 1_000_000).toFixed(2)}M` : totalRecipients >= 1_000 ? `${(totalRecipients / 1_000).toFixed(0)}K` : String(totalRecipients) },
    { label: 'Overall Conv. Rate', value: `${(weightedConv * 100).toFixed(2)}%` },
    { label: 'Revenue Per Recipient', value: `$${rpr.toFixed(2)}` },
  ];

  const inactivePercent = total > 0 ? Math.round((draftPaused / total) * 100) : 0;
  const monthlyRevenue = annualRevenue / 12;

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-4">Executive Summary</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        {topRow.map((s, i) => (
          <div key={s.label} className={`bg-white rounded-xl border border-gray-100 p-4 text-center ${topColors[i]}`}>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {bottomRow.map((s, i) => (
          <div key={s.label} className={`bg-white rounded-xl border border-gray-100 p-4 text-center ${bottomColors[i]}`}>
            <p className={`text-2xl font-bold ${s.accent ?? 'text-gray-900'}`}>{s.value}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {performance.length > 0 && (
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
