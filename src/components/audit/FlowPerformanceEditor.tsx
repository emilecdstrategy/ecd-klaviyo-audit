import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { FlowPerformance } from '../../lib/types';
import { listFlowPerformance, updateFlowPerformanceRow } from '../../lib/db';
import { useToast } from '../ui/Toast';
import { formatCurrency, isNonRevenueFlow } from '../../lib/revenue-calculator';

interface Props {
  auditId: string;
}

type RowPatch = Partial<Pick<
  FlowPerformance,
  'is_hidden' | 'display_name' | 'display_assessment' | 'display_rating' | 'display_order'
>>;

const RATING_OPTIONS: Array<{ value: '' | 'good' | 'warning' | 'bad' | 'missing'; label: string; cls: string }> = [
  { value: '', label: 'Auto', cls: 'text-gray-500' },
  { value: 'good', label: 'Good', cls: 'text-emerald-700' },
  { value: 'warning', label: 'Warning', cls: 'text-amber-700' },
  { value: 'bad', label: 'Bad', cls: 'text-red-700' },
  { value: 'missing', label: 'Missing', cls: 'text-gray-500' },
];

type MetricStatus = 'good' | 'warning' | 'bad' | 'missing';

function metricStatus(actual: number | null, low: number): MetricStatus {
  if (actual === null) return 'missing';
  if (actual >= low) return 'good';
  if (actual >= low * 0.7) return 'warning';
  return 'bad';
}

function overallRating(flow: FlowPerformance): MetricStatus {
  const nonRevenue = isNonRevenueFlow(flow.flow_name);
  const scores = [
    metricStatus(flow.actual_open_rate, flow.benchmark_open_rate_low),
    metricStatus(flow.actual_click_rate, flow.benchmark_click_rate_low),
    ...(nonRevenue ? [] : [metricStatus(flow.actual_conv_rate, flow.benchmark_conv_rate_low)]),
  ];
  const bad = scores.filter(s => s === 'bad').length;
  const good = scores.filter(s => s === 'good').length;
  if (bad >= 2) return 'bad';
  if (good >= 2) return 'good';
  if (nonRevenue && good >= 1) return 'good';
  return 'warning';
}

function buildAssessment(flow: FlowPerformance): string {
  const nonRevenue = isNonRevenueFlow(flow.flow_name);
  const parts: string[] = [];
  const openStatus = metricStatus(flow.actual_open_rate, flow.benchmark_open_rate_low);
  const clickStatus = metricStatus(flow.actual_click_rate, flow.benchmark_click_rate_low);

  if (openStatus === 'bad' && flow.actual_open_rate !== null) {
    parts.push(`Open rate ${(flow.actual_open_rate * 100).toFixed(1)}% below ${(flow.benchmark_open_rate_low * 100).toFixed(0)}-${(flow.benchmark_open_rate_high * 100).toFixed(0)}% benchmark`);
  }
  if (clickStatus === 'bad' && flow.actual_click_rate !== null) {
    parts.push(`Click ${(flow.actual_click_rate * 100).toFixed(1)}% vs. ${(flow.benchmark_click_rate_low * 100).toFixed(0)}-${(flow.benchmark_click_rate_high * 100).toFixed(0)}% benchmark`);
  }

  if (!nonRevenue) {
    const convStatus = metricStatus(flow.actual_conv_rate, flow.benchmark_conv_rate_low);
    if (convStatus === 'bad' && flow.actual_conv_rate !== null) {
      parts.push(`Conv ${(flow.actual_conv_rate * 100).toFixed(2)}% vs. ${(flow.benchmark_conv_rate_low * 100).toFixed(1)}-${(flow.benchmark_conv_rate_high * 100).toFixed(0)}% benchmark`);
    }

    const rpr = flow.recipients_per_month > 0 ? flow.monthly_revenue_current / flow.recipients_per_month : 0;
    if (flow.recipients_per_month > 50_000 && rpr < 0.02) {
      parts.push(`Massive volume, tiny conversion. ${flow.recipients_per_month.toLocaleString()} recipients for ${formatCurrency(flow.monthly_revenue_current)}`);
    }
  }

  if (parts.length === 0) {
    if (nonRevenue) return 'Non-revenue flow. Engagement metrics look healthy.';
    const rating = overallRating(flow);
    if (rating === 'good') return 'Performing well relative to benchmarks.';
    return 'Moderate performance, room for improvement.';
  }

  return parts.slice(0, 2).join('. ') + '.';
}

export default function FlowPerformanceEditor({ auditId }: Props) {
  const [rows, setRows] = useState<FlowPerformance[] | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listFlowPerformance(auditId);
        if (cancelled) return;
        data.sort((a, b) => {
          if (typeof a.display_order === 'number' && typeof b.display_order === 'number') {
            return a.display_order - b.display_order;
          }
          return b.monthly_revenue_current - a.monthly_revenue_current;
        });
        setRows(data);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load flow performance');
      }
    })();
    return () => { cancelled = true; };
  }, [auditId]);

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }
  if (rows === null) {
    return <p className="text-xs text-gray-500">Loading flows…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">
        No per-flow performance data recorded for this audit yet.
      </p>
    );
  }

  const patch = async (id: string, p: RowPatch) => {
    setRows(prev => prev?.map(r => r.id === id ? { ...r, ...p } : r) ?? prev);
    try {
      await updateFlowPerformanceRow(id, p);
      toast('Flow updated');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update flow');
    }
  };

  return (
    <div className="bg-white rounded-xl card-shadow overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Flow Performance Rows</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Hide rows, override names, assessments, or ratings shown in the public report. Underlying metrics stay intact for re-runs.
          </p>
        </div>
        <span className="text-[11px] text-gray-400">{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide w-16">Show</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Flow</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Display name</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide w-32">Rating</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide min-w-[240px]">Assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(r => {
              const hidden = Boolean(r.is_hidden);
              return (
                <tr key={r.id} className={hidden ? 'bg-amber-50/40' : ''}>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => patch(r.id, { is_hidden: !hidden })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                        hidden ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                      title={hidden ? 'Row is hidden in public report' : 'Row is visible'}
                    >
                      {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {hidden ? 'Hidden' : 'Visible'}
                    </button>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-sm font-medium text-gray-800">{r.flow_name}</div>
                    <div className="text-[11px] text-gray-400">
                      {r.recipients_per_month.toLocaleString()} recipients/mo
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={r.display_name ?? r.flow_name}
                      placeholder={r.flow_name}
                      onChange={e => patch(r.id, { display_name: e.target.value || null })}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      value={r.display_rating ?? ''}
                      onChange={e => patch(r.id, { display_rating: (e.target.value || null) as FlowPerformance['display_rating'] })}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm bg-white"
                    >
                      {RATING_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <textarea
                      rows={2}
                      value={r.display_assessment ?? buildAssessment(r)}
                      placeholder="Auto-generated from benchmarks"
                      onChange={e => patch(r.id, { display_assessment: e.target.value || null })}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
