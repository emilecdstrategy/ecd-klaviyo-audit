import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, ExternalLink, Info, TrendingDown, TrendingUp } from 'lucide-react';
import type { AuditSection } from '../../../lib/types';
import {
  formatDelta,
  formatMoney,
  parseWebAnalyticsDetail,
  productUrl,
  type BasketProduct,
  type OrdersRollup,
  type WebAnalyticsPlay,
} from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import HoverTooltip from '../../ui/HoverTooltip';

/** Store performance, as numbers worth knowing plus a few things to ship.
 *
 * Shape, in priority order: a KPI band, then each opportunity as a full-width
 * card with its headline figure, one line of evidence, the work as bullets, and
 * the ACTUAL products it concerns rendered as cards with their real photo, price
 * and a link to the live page. A strategist should be able to read a card and
 * brief someone from it without opening Shopify.
 */

const KPIS: Array<{ key: string; label: string }> = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'orders', label: 'Orders' },
  { key: 'aov', label: 'Avg order value' },
  { key: 'returning_customer_rate', label: 'Repeat rate' },
];

function ProductCard({
  product,
  storeBase,
  currency,
  compact = false,
}: {
  product: BasketProduct;
  storeBase?: string | null;
  currency: string;
  /** Row layout with a thumbnail, for the one to three products a play names.
   *  The tall grid card is for the best-seller wall, where the photo is the point. */
  compact?: boolean;
}) {
  const href = productUrl(storeBase, product.handle);
  const meta = [
    product.units != null && product.units > 0 ? `${product.units} sold` : null,
    product.unit_price != null ? `${formatMoney(product.unit_price, currency)} each` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (compact) {
    return (
      <ProductShell href={href} className="flex items-center gap-3 p-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-50">
          {product.image ? (
            <img src={product.image} alt={product.title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">no photo</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-gray-900 group-hover/prod:text-brand-primary">
            {product.title}
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight text-gray-900">{formatMoney(product.revenue, currency)}</span>
            {meta && <span className="truncate text-[11px] text-gray-500">{meta}</span>}
          </p>
        </div>
        {href && (
          <ExternalLink className="h-3 w-3 shrink-0 text-gray-300 transition-colors group-hover/prod:text-brand-primary" />
        )}
      </ProductShell>
    );
  }

  const body = (
    <>
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-gray-50">
        {product.image ? (
          <img src={product.image} alt={product.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">no photo</div>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-gray-900 group-hover/prod:text-brand-primary">
        {product.title}
      </p>
      {/* Revenue leads, because that is what the grid is ordered by: showing
          units alone made a $200 item with 3 sales look misplaced above a $15
          item with 5. Units and unit price sit underneath as the supporting
          detail, at a readable size rather than fine print. */}
      <p className="mt-1.5 text-sm font-semibold tracking-tight text-gray-900">
        {formatMoney(product.revenue, currency)}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {product.units != null && product.units > 0 ? `${product.units} sold` : null}
        {product.units != null && product.units > 0 && product.unit_price != null ? ' · ' : null}
        {product.unit_price != null ? `${formatMoney(product.unit_price, currency)} each` : null}
      </p>
      {href && (
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-primary opacity-0 transition-opacity group-hover/prod:opacity-100">
          View <ExternalLink className="h-2.5 w-2.5" />
        </span>
      )}
    </>
  );

  return (
    <ProductShell href={href} className="block p-2.5">
      {body}
    </ProductShell>
  );
}

/** The bordered box a product card lives in, a link when the product has a live
 *  page and a plain div when it does not. */
function ProductShell({
  href,
  className,
  children,
}: {
  href: string | null;
  className: string;
  children: ReactNode;
}) {
  const shell = `group/prod rounded-xl border border-gray-100 ${className}`;
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${shell} transition-colors hover:border-brand-primary/40 hover:bg-brand-surface/40`}
    >
      {children}
    </a>
  ) : (
    <div className={shell}>{children}</div>
  );
}

function PlayCard({
  play,
  products,
  storeBase,
  currency,
  editMode,
  onEdit,
}: {
  play: WebAnalyticsPlay;
  products: BasketProduct[];
  storeBase?: string | null;
  currency: string;
  editMode: boolean;
  onEdit: (field: 'title' | 'insight' | 'metric' | 'window', value: string) => void;
  }) {
  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 text-base font-semibold leading-snug text-gray-900">
          <EditablePlainText value={play.title} onSave={(v) => onEdit('title', v)} placeholder="Play title…" />
        </h4>
        {(play.metric || editMode) && (
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-brand-primary">
              <EditablePlainText value={play.metric} onSave={(v) => onEdit('metric', v)} placeholder="headline figure" />
            </p>
            {(play.window || editMode) && (
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                <EditablePlainText value={play.window} onSave={(v) => onEdit('window', v)} placeholder="window" />
              </p>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        <EditablePlainText value={play.insight} onSave={(v) => onEdit('insight', v)} placeholder="What the data shows…" />
      </p>

      {play.action_steps.length > 0 && (
        <div className="mt-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">What to do</p>
          <ul className="mt-1.5 space-y-1.5">
            {play.action_steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-4 border-t border-gray-50 pt-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Products in play</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <ProductCard key={p.title} product={p} storeBase={storeBase} currency={currency} compact />
            ))}
          </div>
        </div>
      )}
    </article>
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
  const storeBase = rollup?.store_url_base ?? null;

  // Products a play names, resolved against the order data so a card always has
  // a real photo, price and link. Matched case-insensitively because the model
  // copies titles by hand.
  const catalog = useMemo(() => {
    const map = new Map<string, BasketProduct>();
    for (const p of basket?.top_products ?? basket?.top_products_by_units ?? []) map.set(p.title.trim().toLowerCase(), p);
    return map;
  }, [basket?.top_products, basket?.top_products_by_units]);
  const productsFor = (play: WebAnalyticsPlay): BasketProduct[] =>
    play.products.map((t) => catalog.get(t.trim().toLowerCase())).filter((p): p is BasketProduct => Boolean(p));

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

  const topProducts = basket?.top_products ?? basket?.top_products_by_units ?? [];

  return (
    <section className="rounded-2xl bg-white p-6 card-shadow sm:p-7">
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Store Performance</h2>}
      <p className={`text-xs text-gray-400${hideTitle ? '' : ' mt-0.5'}`}>
        Shopify order data, last 30 days vs the prior 30 days
      </p>

      {/* KPI band */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map(({ key, label }) => {
          const delta = deltaFor(key);
          const isRepeat = key === 'returning_customer_rate';
          return (
            <div key={key} className="rounded-xl bg-brand-surface/60 px-4 py-3.5">
              <div className="flex items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                {isRepeat && repeatUnavailable && editMode && (
                  <HoverTooltip
                    label="Not available yet"
                    description="This store's Shopify app has not granted the read_customers scope, so repeat-purchase data cannot be read. Ticking it in the app's Admin API scopes fills this in on the next audit."
                  >
                    <Info className="h-3 w-3 text-gray-300" />
                  </HoverTooltip>
                )}
              </div>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{displayValue(key)}</p>
              {delta ? (
                <p className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${delta.positive ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {delta.text}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-gray-300">no comparison</p>
              )}
            </div>
          );
        })}
      </div>

      {(editMode || section.summary_text) && (
        <div className="mt-4 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="One sentence on where the store stands…"
          />
        </div>
      )}

      {/* Opportunities, one card per row so each has room for its bullets and products. */}
      {plays.length > 0 && (
        <div className="mt-7 border-t border-gray-100 pt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Opportunities in the data</h3>
          <div className="mt-3 space-y-3">
            {plays.map((play, i) => (
              <PlayCard
                key={i}
                play={play}
                products={productsFor(play)}
                storeBase={storeBase}
                currency={currency}
                editMode={editMode}
                onEdit={(f, v) => setPlay(i, f, v)}
              />
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
              {m.recommendation && (
                <p className="mt-1 text-gray-500"><span className="font-medium text-gray-700">Fix: </span>{m.recommendation}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Best sellers as real cards, then the basket shape and channels beside them. */}
      {topProducts.length > 0 && (
        <div className="mt-7 border-t border-gray-100 pt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Best sellers <span className="font-normal normal-case tracking-normal text-gray-400">by revenue</span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {topProducts.slice(0, 6).map((p) => (
              <ProductCard key={p.title} product={p} storeBase={storeBase} currency={currency} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-7 border-t border-gray-100 pt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {basket && basket.orders_analyzed ? (
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Typical basket</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-gray-500">Items per order</span>
                <span className="font-medium text-gray-900">{basket.units_per_order ?? '—'}</span>
              </li>
              {basket.single_item_order_share != null && (
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-gray-500">One-product orders</span>
                  <span className="font-medium text-gray-900">{basket.single_item_order_share}%</span>
                </li>
              )}
              {basket.order_value_percentiles?.p50 != null && (
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-gray-500">Median order</span>
                  <span className="font-medium text-gray-900">{formatMoney(basket.order_value_percentiles.p50, currency)}</span>
                </li>
              )}
              {basket.order_value_percentiles?.p90 != null && (
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-gray-500">Top 10% of orders above</span>
                  <span className="font-medium text-gray-900">{formatMoney(basket.order_value_percentiles.p90, currency)}</span>
                </li>
              )}
              {basket.discounted_order_share != null && (
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-gray-500">Orders with a discount</span>
                  <span className="font-medium text-gray-900">
                    {basket.discounted_order_share}%
                    {basket.avg_discount_depth_pct ? ` at ${basket.avg_discount_depth_pct}% off` : ''}
                  </span>
                </li>
              )}
            </ul>
            <p className="mt-2 text-[10px] text-gray-400">
              {basket.orders_analyzed} orders over {basket.window_days} days
              {basket.confident === false ? ', too few to be conclusive' : ''}
              {basket.order_history_limited ? '. Shopify caps order history at 60 days without the read_all_orders scope.' : ''}
            </p>
          </div>
        ) : null}

        {rollup?.channels && rollup.channels.length > 0 && (
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Where orders come from</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {rollup.channels.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="truncate capitalize text-gray-500">{c.name}</span>
                  <span className="shrink-0 font-medium text-gray-900">
                    {formatMoney(c.revenue, currency)}
                    <span className="ml-1.5 text-[10px] font-normal text-gray-400">{c.orders} orders</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
