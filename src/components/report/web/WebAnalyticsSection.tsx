import { useMemo } from 'react';
import type { AuditSection } from '../../../lib/types';
import {
  formatDelta,
  formatMoney,
  parseWebAnalyticsDetail,
  type OrdersRollup,
  type WebAnalyticsMetric,
} from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';

const NUMERIC_METRICS: Array<{ key: string; label: string }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'orders', label: 'Orders' },
  { key: 'aov', label: 'Avg Order Value' },
  { key: 'returning_customer_rate', label: 'Returning Rate' },
];

export default function WebAnalyticsSection({ section, rollup }: { section: AuditSection; rollup: OrdersRollup | null }) {
  const { editMode, updateSectionField, updateSectionDetailValue } = useReportEdit();
  const detail = useMemo(() => parseWebAnalyticsDetail(section.section_details), [section.section_details]);
  const metrics = detail?.metrics ?? [];
  const currency = rollup?.currency ?? 'USD';

  const metricByKey = new Map(metrics.map((m) => [m.key, m]));

  const setMetric = (key: string, field: 'commentary' | 'recommendation', value: string) => {
    const next: WebAnalyticsMetric[] = metrics.some((m) => m.key === key)
      ? metrics.map((m) => (m.key === key ? { ...m, [field]: value } : m))
      : [...metrics, { key, commentary: '', recommendation: '', [field]: value } as WebAnalyticsMetric];
    updateSectionDetailValue(section.section_key, ['web_analytics', 'metrics'], next);
  };

  const displayValue = (key: string): string => {
    const cur = rollup?.current;
    if (!cur) return '—';
    if (key === 'revenue') return formatMoney(cur.gross_revenue, currency);
    if (key === 'orders') return cur.order_count.toLocaleString('en-US');
    if (key === 'aov') return formatMoney(cur.aov, currency);
    if (key === 'returning_customer_rate') return `${cur.returning_customer_rate}%`;
    return '—';
  };

  const deltaFor = (key: string) => {
    const d = rollup?.deltas ?? {};
    const map: Record<string, number | null | undefined> = {
      revenue: d.gross_revenue,
      orders: d.order_count,
      aov: d.aov,
      returning_customer_rate: d.returning_customer_rate,
    };
    return formatDelta(map[key]);
  };

  return (
    <section className="rounded-xl bg-white p-6 card-shadow">
      <h2 className="text-lg font-semibold text-gray-900">Data &amp; Analytics</h2>
      <p className="mt-0.5 text-xs text-gray-400">Last 30 days vs the prior 30 days</p>
      {(editMode || section.summary_text) && (
        <div className="mt-1.5 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="Summary of the store's performance…"
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {NUMERIC_METRICS.map(({ key, label }) => {
          const delta = deltaFor(key);
          const m = metricByKey.get(key);
          return (
            <div key={key} className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-0.5 text-lg font-semibold text-gray-900">{displayValue(key)}</p>
              {delta && (
                <p className={`text-xs font-medium ${delta.positive ? 'text-emerald-600' : 'text-red-600'}`}>{delta.text}</p>
              )}
              {(editMode || m?.commentary || m?.recommendation) && (
                <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-600">
                  <EditablePlainText value={m?.commentary ?? ''} onSave={(v) => setMetric(key, 'commentary', v)} placeholder="Commentary…" />
                  {(editMode || m?.recommendation) && (
                    <div className="text-gray-500">
                      <span className="font-medium text-gray-700">Fix: </span>
                      <EditablePlainText value={m?.recommendation ?? ''} onSave={(v) => setMetric(key, 'recommendation', v)} placeholder="Recommendation…" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rollup?.top_products && rollup.top_products.length > 0 && (
          <div className="rounded-lg border border-gray-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top Products (30d)</p>
            <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
              {rollup.top_products.slice(0, 5).map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.title}</span>
                  <span className="shrink-0 font-medium text-gray-900">{formatMoney(p.revenue, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {rollup?.channels && rollup.channels.length > 0 && (
          <div className="rounded-lg border border-gray-100 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sales by Channel (30d)</p>
            <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
              {rollup.channels.slice(0, 6).map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate capitalize">{c.name}</span>
                  <span className="shrink-0 font-medium text-gray-900">{formatMoney(c.revenue, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
