import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, Eye, EyeOff, ExternalLink, Info, Plus, TrendingDown, TrendingUp, Trash2 } from 'lucide-react';
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
            <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">no photo</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-gray-900 group-hover/prod:text-brand-primary">
            {product.title}
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tracking-tight text-gray-900">{formatMoney(product.revenue, currency)}</span>
            {meta && <span className="truncate text-xs text-gray-500">{meta}</span>}
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
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">no photo</div>
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
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-primary opacity-0 transition-opacity group-hover/prod:opacity-100">
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
  number,
  products,
  storeBase,
  currency,
  editMode,
  onEdit,
  onPatch,
  onRemove,
}: {
  play: WebAnalyticsPlay;
  /** Its position in the list, so a play can be pointed at on a call. */
  number: number;
  products: BasketProduct[];
  storeBase?: string | null;
  currency: string;
  editMode: boolean;
  onEdit: (field: 'title' | 'insight' | 'metric' | 'window', value: string) => void;
  onPatch: (patch: Partial<WebAnalyticsPlay>) => void;
  onRemove: () => void;
  }) {
  const setStep = (index: number, value: string) =>
    onPatch({ action_steps: play.action_steps.map((s, i) => (i === index ? value : s)) });
  const addStep = () => onPatch({ action_steps: [...play.action_steps, ''] });
  const removeStep = (index: number) =>
    onPatch({ action_steps: play.action_steps.filter((_, i) => i !== index) });

  return (
    <article
      className={`relative rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${
        play.hidden ? 'opacity-50' : ''
      }`}
    >
      {editMode && (
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPatch({ hidden: !play.hidden })}
            title={play.hidden ? 'Show in the report' : 'Hide from the report'}
            className="rounded p-1 text-gray-300 transition-colors hover:bg-gray-50 hover:text-gray-600"
          >
            {play.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Delete this opportunity"
            className="rounded p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="flex min-w-0 items-start gap-2.5 text-base font-semibold leading-snug text-gray-900">
          <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-surface text-xs font-bold tabular-nums text-brand-primary">
            {number}
          </span>
          <span className="min-w-0">
            <EditablePlainText value={play.title} onSave={(v) => onEdit('title', v)} placeholder="Play title…" />
          </span>
        </h4>
        {(play.metric || editMode) && (
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-brand-primary">
              <EditablePlainText value={play.metric} onSave={(v) => onEdit('metric', v)} placeholder="headline figure" />
            </p>
            {(play.window || editMode) && (
              <p className="text-xs uppercase tracking-wide text-gray-400">
                <EditablePlainText value={play.window} onSave={(v) => onEdit('window', v)} placeholder="window" />
              </p>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        <EditablePlainText value={play.insight} onSave={(v) => onEdit('insight', v)} placeholder="What the data shows…" />
      </p>

      {(play.action_steps.length > 0 || editMode) && (
        <div className="mt-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">What to do</p>
          <ul className="mt-1.5 space-y-1.5">
            {play.action_steps.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-700">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
                <span className="min-w-0 flex-1">
                  <EditablePlainText
                    value={step}
                    onSave={editMode ? v => setStep(i, v) : undefined}
                    placeholder="What to ship…"
                  />
                </span>
                {editMode && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    title="Remove this step"
                    className="shrink-0 rounded p-0.5 text-gray-300 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editMode && (
            <button
              type="button"
              onClick={addStep}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Add a step
            </button>
          )}
        </div>
      )}

      {products.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Products in play</p>
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

/** Snapshots taken before the fetcher learned to name apps stored Shopify's raw
 *  sourceName, which for an app-placed order is that app's numeric id. */
function channelName(raw: string): string {
  const v = (raw ?? '').trim();
  if (/^d+$/.test(v)) return 'Other app';
  if (v.toLowerCase() === 'web') return 'Online store';
  if (v.toLowerCase() === 'pos') return 'Point of sale';
  return v.replace(/_/g, ' ');
}

/** A figure on a dotted leader, the way a menu prices a dish. Reads faster down
 *  a column than label-left/value-right separated by empty space. */
function LeaderRow({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="shrink-0 text-gray-600">{label}</span>
      <span className="min-w-[1rem] flex-1 translate-y-[-0.2em] border-b border-dotted border-gray-300" aria-hidden />
      <span className="shrink-0 font-medium tabular-nums text-gray-900">{value}</span>
    </li>
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

  const writePlays = (next: WebAnalyticsPlay[]) =>
    updateSectionDetailValue(section.section_key, ['web_analytics', 'plays'], next);

  const setPlay = (i: number, field: keyof WebAnalyticsPlay, value: string) => {
    writePlays(plays.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  };

  const patchPlay = (i: number, patch: Partial<WebAnalyticsPlay>) => {
    writePlays(plays.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const removePlay = (i: number) => writePlays(plays.filter((_, idx) => idx !== i));

  const addPlay = () =>
    writePlays([
      ...plays,
      { title: '', insight: '', action_steps: [''], products: [], metric: '', window: '', hidden: false },
    ]);

  // Hidden plays stay visible while editing, dimmed, so hiding one is reversible
  // without hunting through the data.
  const visiblePlays = plays.map((p, i) => ({ p, i })).filter(({ p }) => editMode || !p.hidden);

  const repeatUnavailable = rollup?.returning_customer_rate_available === false;
  // Published with the figure so the tile can say what the number actually means
  // rather than leaving "repeat rate" to be read as lifetime loyalty.
  const repeatLookbackDays = rollup?.repeat_basis?.lookback_days ?? 90;

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
  const channelTotal = (rollup?.channels ?? []).slice(0, 5).reduce((sum, c) => sum + (c.revenue || 0), 0);

  // Never claim a window the data does not cover. On a store doing more than
  // 2,000 orders a month the fetch reaches only its most recent days, and
  // labelling that "last 30 days" quartered a client's real revenue.
  const periodDays = rollup?.period_days ?? 30;
  const windowLabel = rollup?.period_truncated
    ? `Shopify order data, the most recent ${periodDays} ${periodDays === 1 ? 'day' : 'days'} (2,000-order fetch limit reached, so there is no prior-period comparison)`
    : 'Shopify order data, last 30 days vs the prior 30 days';

  return (
    <section className="rounded-2xl bg-white p-6 card-shadow sm:p-7">
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Store Performance</h2>}
      <p className={`text-xs text-gray-400${hideTitle ? '' : ' mt-0.5'}`}>
        {windowLabel}
      </p>

      {/* KPI band */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map(({ key, label }) => {
          const delta = deltaFor(key);
          const isRepeat = key === 'returning_customer_rate';
          return (
            <div key={key} className="rounded-xl bg-brand-surface/60 px-4 py-3.5">
              <div className="flex items-center gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                {isRepeat && !repeatUnavailable && (
                  <HoverTooltip
                    label="How this is measured"
                    description={`The share of orders placed by someone who had already bought from you in the previous ${repeatLookbackDays} days. Both periods are measured the same way, so the comparison is like for like.`}
                  >
                    <Info className="h-3 w-3 text-gray-300" />
                  </HoverTooltip>
                )}
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
                <p className="mt-0.5 text-xs text-gray-300">
                  {isRepeat && repeatUnavailable
                    ? (editMode ? 'needs read_customers' : 'not available')
                    : 'no comparison'}
                </p>
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
          <div className="mt-3.5 space-y-4">
            {visiblePlays.map(({ p: play, i }, position) => (
              <PlayCard
                key={i}
                play={play}
                number={position + 1}
                products={productsFor(play)}
                storeBase={storeBase}
                currency={currency}
                editMode={editMode}
                onEdit={(field, v) => setPlay(i, field, v)}
                onPatch={patch => patchPlay(i, patch)}
                onRemove={() => removePlay(i)}
              />
            ))}
          </div>
          {editMode && (
            <button
              type="button"
              onClick={addPlay}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Add an opportunity
            </button>
          )}
        </div>
      )}

      {/* With no plays at all there is nothing to add one to, so the button lives
          here as well rather than the section vanishing in edit mode. */}
      {editMode && plays.length === 0 && (
        <div className="mt-7 border-t border-gray-100 pt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Opportunities in the data</h3>
          <button
            type="button"
            onClick={addPlay}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
          >
            <Plus className="h-3 w-3" /> Add an opportunity
          </button>
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Typical basket</h3>
            <ul className="mt-2.5 space-y-2 text-sm">
              <LeaderRow label="Items per order" value={basket.units_per_order ?? '—'} />
              {basket.single_item_order_share != null && (
                <LeaderRow label="One-product orders" value={basket.single_item_order_share + '%'} />
              )}
              {basket.order_value_percentiles?.p50 != null && (
                <LeaderRow label="Median order" value={formatMoney(basket.order_value_percentiles.p50, currency)} />
              )}
              {basket.order_value_percentiles?.p90 != null && (
                <LeaderRow label="Top 10% of orders above" value={formatMoney(basket.order_value_percentiles.p90, currency)} />
              )}
              {basket.discounted_order_share != null && (
                <LeaderRow
                  label="Orders with a discount"
                  value={basket.discounted_order_share + '%' + (basket.avg_discount_depth_pct ? ' at ' + basket.avg_discount_depth_pct + '% off' : '')}
                />
              )}
            </ul>
            <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
              {basket.orders_analyzed} orders over {basket.window_days} days
              {basket.confident === false ? ', too few to be conclusive' : ''}
              {basket.orders_truncated
                ? '. Capped at the 2,000 most recent orders, so this is your busiest recent window rather than a longer trend.'
                : basket.order_history_limited
                  ? '. Shopify caps order history at 60 days without the read_all_orders scope.'
                  : ''}
            </p>
          </div>
        ) : null}

        {rollup?.channels && rollup.channels.length > 0 && (
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Where orders come from</h3>
            <ul className="mt-2.5 space-y-2.5 text-sm">
              {rollup.channels.slice(0, 5).map((c, i) => {
                const share = channelTotal > 0 ? (c.revenue / channelTotal) * 100 : 0;
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate capitalize text-gray-600">{channelName(c.name)}</span>
                      <span className="shrink-0 font-medium tabular-nums text-gray-900">
                        {formatMoney(c.revenue, currency)}
                        <span className="ml-1.5 text-xs font-normal text-gray-400">{c.orders} orders</span>
                      </span>
                    </div>
                    {/* Share of the channels shown, so the bars fill the row
                        rather than shrinking against an unseen long tail. */}
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand-primary/70"
                        style={{ width: (share > 0 ? Math.max(share, 1.5) : 0) + '%' }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
