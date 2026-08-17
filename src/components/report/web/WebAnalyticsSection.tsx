import { useMemo } from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import type { AuditSection } from '../../../lib/types';
import {
  formatDelta,
  formatMoney,
  parseWebAnalyticsDetail,
  type OrdersRollup,
  type WebAnalyticsPlay,
} from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import HoverTooltip from '../../ui/HoverTooltip';

/** The store's backend performance, as a KPI strip plus a short list of plays.
 *
 * This section used to be four metric cards each carrying a paragraph of
 * commentary and a paragraph of advice, which read as a wall of text saying
 * little: "revenue is down, consider reviewing your marketing". A strategist
 * opening it wants the opposite shape, a couple of numbers worth knowing and a
 * few things to actually ship, each anchored to a figure from the order data.
 * So the numbers are cards, the thinking is plays, and the prose is gone.
 */

const KPIS: Array<{ key: string; label: string }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'orders', label: 'Orders' },
  { key: 'aov', label: 'Avg order' },
  { key: 'returning_customer_rate', label: 'Repeat rate' },
];

function PlayCard({
  play,
  index,
  editMode,
  onEdit,
}: {
  play: WebAnalyticsPlay;
  index: number;
  editMode: boolean;
  onEdit: (field: keyof WebAnalyticsPlay, value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 transition-colors hover:border-brand-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            <EditablePlainText value={play.title} onSave={(v) => onEdit('title', v)} placeholder="Play title…" />
          </p>
        </div>
        {(play.metric || editMode) && (
          <span className="shrink-0 rounded-lg bg-brand-primary/5 px-2 py-1 text-[11px] font-semibold text-brand-primary">
            <EditablePlainText value={play.metric} onSave={(v) => onEdit('metric', v)} placeholder="metric" />
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
        <EditablePlainText value={play.insight} onSave={(v) => onEdit('insight', v)} placeholder="What the data shows…" />
      </p>
      <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-brand-surface px-3 py-2">
        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
        <p className="text-sm leading-relaxed text-gray-700">
          <EditablePlainText value={play.action} onSave={(v) => onEdit('action', v)} placeholder="What to ship…" />
        </p>
      </div>
      {(play.window || editMode) && (
        <p className="mt-1.5 text-[11px] text-gray-400">
          <EditablePlainText value={play.window} onSave={(v) => onEdit('window', v)} placeholder="window" />
        </p>
      )}
      <span className="sr-only">Play {index + 1}</span>
    </div>
  );
}

export default function WebAnalyticsSection({
  section,
  rollup,
  hideTitle = false,
}: {
  section: AuditSection;
  rollup: OrdersRollup | null;
  /** The report frame already renders a numbered section heading. */
  hideTitle?: boolean;
}) {
  const { editMode, updateSectionField, updateSectionDetailValue } = useReportEdit();
  const detail = useMemo(() => parseWebAnalyticsDetail(section.section_details), [section.section_details]);
  const plays = detail?.plays ?? [];
  const legacyMetrics = detail?.metrics ?? [];
  const currency = rollup?.currency ?? 'USD';
  const basket = rollup?.basket;

  const setPlay = (i: number, field: keyof WebAnalyticsPlay, value: string) => {
    const next = plays.map((p, idx) => (idx === i ? { ...p, [field]: value } : p));
    updateSectionDetailValue(section.section_key, ['web_analytics', 'plays'], next);
  };

  const repeatUnavailable = rollup?.returning_customer_rate_available === false;

  const displayValue = (key: string): string => {
    const cur = rollup?.current;
    if (!cur) return '—';
    if (key === 'revenue') return formatMoney(cur.gross_revenue, currency);
    if (key === 'orders') return cur.order_count.toLocaleString('en-US');
    if (key === 'aov') return formatMoney(cur.aov, currency);
    if (key === 'returning_customer_rate') {
      return cur.returning_customer_rate == null ? '—' : `${cur.returning_customer_rate}%`;
    }
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
    <section className="rounded-2xl bg-white p-6 card-shadow sm:p-7">
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Store Performance</h2>}
      <p className={`text-xs text-gray-400${hideTitle ? '' : ' mt-0.5'}`}>Last 30 days vs the prior 30 days</p>

      {/* KPI strip: numbers only. Anything worth saying about them is a play. */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map(({ key, label }) => {
          const delta = deltaFor(key);
          const isRepeat = key === 'returning_customer_rate';
          return (
            <div key={key} className="rounded-xl border border-gray-100 px-3.5 py-3">
              <div className="flex items-center gap-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
                {isRepeat && repeatUnavailable && editMode && (
                  <HoverTooltip
                    label="Not available yet"
                    description="This store's Shopify custom app has not granted the read_customers scope, so repeat-purchase data cannot be read. Ticking it in the app's Admin API scopes fills this in on the next audit."
                  >
                    <Info className="h-3 w-3 text-gray-300" />
                  </HoverTooltip>
                )}
              </div>
              <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">{displayValue(key)}</p>
              {delta ? (
                <p className={`mt-0.5 text-xs font-medium ${delta.positive ? 'text-emerald-600' : 'text-red-600'}`}>{delta.text}</p>
              ) : (
                <p className="mt-0.5 text-xs text-gray-300">no comparison</p>
              )}
            </div>
          );
        })}
      </div>

      {/* One-sentence framing, then the plays. */}
      {(editMode || section.summary_text) && (
        <div className="mt-4 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="One sentence on where the store stands…"
          />
        </div>
      )}

      {plays.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Opportunities in the data</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {plays.map((play, i) => (
              <PlayCard key={i} play={play} index={i} editMode={editMode} onEdit={(f, v) => setPlay(i, f, v)} />
            ))}
          </div>
        </div>
      )}

      {/* Older audits carry per-metric commentary instead of plays. */}
      {plays.length === 0 && legacyMetrics.length > 0 && (
        <div className="mt-5 space-y-2">
          {legacyMetrics.map((m) => (
            <div key={m.key} className="rounded-lg border border-gray-100 p-3 text-sm text-gray-600">
              <p>{m.commentary}</p>
              {m.recommendation && <p className="mt-1 text-gray-500"><span className="font-medium text-gray-700">Fix: </span>{m.recommendation}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Supporting detail, kept compact: the shape of a typical basket, then the
          products and channels behind the revenue. */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {basket && basket.orders_analyzed ? (
          <div className="rounded-xl border border-gray-100 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Typical basket</p>
            <dl className="mt-1.5 space-y-1 text-sm text-gray-700">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Items per order</dt>
                <dd className="font-medium text-gray-900">{basket.units_per_order ?? '—'}</dd>
              </div>
              {basket.single_item_order_share != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">One-product orders</dt>
                  <dd className="font-medium text-gray-900">{basket.single_item_order_share}%</dd>
                </div>
              )}
              {basket.order_value_percentiles?.p50 != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Median order</dt>
                  <dd className="font-medium text-gray-900">{formatMoney(basket.order_value_percentiles.p50, currency)}</dd>
                </div>
              )}
              {basket.discounted_order_share != null && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">With a discount</dt>
                  <dd className="font-medium text-gray-900">{basket.discounted_order_share}%</dd>
                </div>
              )}
            </dl>
            <p className="mt-1.5 text-[11px] text-gray-400">
              {basket.orders_analyzed} orders over {basket.window_days} days
              {basket.confident === false ? ', too few to be conclusive' : ''}
            </p>
          </div>
        ) : null}

        {rollup?.top_products && rollup.top_products.length > 0 && (
          <div className="rounded-xl border border-gray-100 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Top products</p>
            <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
              {rollup.top_products.slice(0, 4).map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate">{p.title}</span>
                  <span className="shrink-0 font-medium text-gray-900">{formatMoney(p.revenue, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rollup?.channels && rollup.channels.length > 0 && (
          <div className="rounded-xl border border-gray-100 px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Channels</p>
            <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
              {rollup.channels.slice(0, 4).map((c, i) => (
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
