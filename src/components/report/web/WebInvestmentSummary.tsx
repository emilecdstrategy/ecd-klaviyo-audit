import { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AuditSection, RevenueOpportunityAddOnItem } from '../../../lib/types';
import {
  buildInvestmentLineItems,
  computeInvestmentTotals,
  groupInvestmentLinesByItem,
} from '../../../lib/investment-summary';
import { parseWebRoadmapDetail, type WebRoadmapRow } from '../../../lib/web-report-details';
import {
  computeWebInvestmentTotals,
  investmentRows,
  parseMonthly,
  setupCost,
} from '../../../lib/web-audit-pricing';
import { formatCurrency } from '../../../lib/revenue-calculator';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import BrandedCheckbox from '../../ui/BrandedCheckbox';

/** What the roadmap adds up to, in the same dotted-leader menu the Klaviyo
 *  report uses. Rows are ticked on the roadmap table above or here; either way
 *  the same `investment_included` flag drives the total and any proposal built
 *  from this audit. */

function PriceRow({
  label,
  amount,
  caption,
  muted = false,
}: {
  label: string;
  amount: string;
  caption?: string;
  muted?: boolean;
}) {
  return (
    <div className={cn('py-2.5', muted && 'opacity-50')}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            'max-w-[58%] shrink-0 text-base font-medium leading-snug text-gray-900',
            muted && 'line-through decoration-gray-300',
          )}
        >
          {label}
        </span>
        <span className="min-w-[1.5rem] flex-1 translate-y-[-0.15em] border-b border-dotted border-gray-300" aria-hidden />
        <span
          className={cn(
            'shrink-0 text-right text-base font-semibold tabular-nums text-gray-900',
            muted && 'line-through decoration-gray-300',
          )}
        >
          {amount}
        </span>
      </div>
      {caption ? <p className="mt-0.5 text-right text-xs text-gray-500">{caption}</p> : null}
    </div>
  );
}

function TotalRow({
  label,
  amount,
  suffix,
  emphasis = false,
}: {
  label: string;
  amount: string;
  suffix?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline gap-2', emphasis ? 'py-1' : 'py-1.5')}>
      <span className={cn('shrink-0 text-gray-700', emphasis ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold')}>
        {label}
      </span>
      <span className="min-w-[1.5rem] flex-1 translate-y-[-0.15em] border-b border-dotted border-gray-300" aria-hidden />
      <span className={cn('shrink-0 text-right tabular-nums text-gray-900', emphasis ? 'text-xl font-bold' : 'text-base font-semibold')}>
        {amount}
        {suffix ? <span className="ml-1 text-sm font-medium text-gray-500">{suffix}</span> : null}
      </span>
    </div>
  );
}

export default function WebInvestmentSummary({
  section,
  addOns,
}: {
  section: AuditSection;
  /** Priced extras attached to this audit (Customer Agent, Helpdesk and the
   *  rest). They are quoted work like any roadmap row, so they belong in the
   *  same total rather than in a separate bill nobody adds up. */
  addOns: RevenueOpportunityAddOnItem[];
}) {
  const { editMode, updateSectionDetailValue, toggleAddOnInvestmentIncluded } = useReportEdit();
  const detail = useMemo(() => parseWebRoadmapDetail(section.section_details), [section.section_details]);
  const rows = detail.rows;
  const hourlyRate = detail.hourly_rate ?? 0;

  const totals = useMemo(() => computeWebInvestmentTotals(rows, hourlyRate), [rows, hourlyRate]);
  const addOnGroups = useMemo(() => groupInvestmentLinesByItem(buildInvestmentLineItems(addOns)), [addOns]);
  const addOnTotals = useMemo(() => computeInvestmentTotals(addOnGroups.flatMap((g) => g.lines)), [addOnGroups]);

  const oneTimeTotal = totals.oneTimeTotal + addOnTotals.oneTimeTotal;
  const monthlyTotal = totals.monthlyTotal + addOnTotals.monthlyTotal;
  const oneTimeLabelOnly = totals.unpricedCount > 0 || addOnTotals.oneTimeHasLabelOnly;
  const monthlyLabelOnly = totals.ongoingLabelOnly || addOnTotals.monthlyHasLabelOnly;

  // Hidden roadmap items never appear here, even in edit mode: they are not part
  // of the report the client reads, so pricing them would be a lie.
  const listed = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.hidden);
  const included = investmentRows(rows);

  const setRow = (i: number, patch: Partial<WebRoadmapRow>) =>
    updateSectionDetailValue(section.section_key, ['web_roadmap', 'rows'], rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const title = detail.investment_title;
  const subtitle = detail.investment_subtitle
    || 'ECD implementation and retainer fees for the roadmap items included above.';

  const rowAmount = (row: WebRoadmapRow): string => {
    const cost = hourlyRate > 0 ? setupCost(row, hourlyRate) : null;
    return cost == null ? (row.setup_cost_label || 'Custom / TBD') : formatCurrency(cost);
  };

  const rowCaption = (row: WebRoadmapRow): string | undefined => {
    const monthly = parseMonthly(row.ongoing_cost_label);
    if (monthly != null) return `plus ${formatCurrency(monthly)}/mo ongoing`;
    const label = (row.ongoing_cost_label ?? '').trim();
    return label && !/^[—-]$/.test(label) ? `plus ${label} ongoing` : undefined;
  };

  const showOneTime = oneTimeTotal > 0 || oneTimeLabelOnly;
  const showMonthly = monthlyTotal > 0 || monthlyLabelOnly;
  const hasAnything = listed.length > 0 || addOnGroups.length > 0;

  return (
    <section className="rounded-2xl bg-white card-shadow">
      <div className="flex items-start gap-3 border-b border-gray-100 px-6 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-surface">
          <Receipt className="h-5 w-5 text-brand-primary" />
        </div>
        <div className="min-w-0">
          {editMode ? (
            <EditablePlainText
              value={title}
              onSave={(v) => updateSectionDetailValue(section.section_key, ['web_roadmap', 'investment_title'], v)}
              className="text-lg font-bold text-gray-900"
              as="span"
            />
          ) : (
            <span className="text-lg font-bold text-gray-900">{title}</span>
          )}
          <div className="mt-0.5">
            {editMode ? (
              <EditablePlainText
                value={subtitle}
                onSave={(v) => updateSectionDetailValue(section.section_key, ['web_roadmap', 'investment_subtitle'], v)}
                className="text-sm text-gray-500"
                as="span"
              />
            ) : (
              <span className="text-sm text-gray-500">{subtitle}</span>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {!hasAnything ? (
          <p className="py-6 text-center text-sm text-gray-500">No roadmap items to price yet.</p>
        ) : (
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-400">
              {editMode ? <span className="w-8 shrink-0" aria-hidden /> : null}
              <span className="flex-1">{addOnGroups.length > 0 ? 'Roadmap' : 'Item'}</span>
              <span className="shrink-0">Investment</span>
            </div>

            <div className="divide-y divide-gray-100">
              {listed.map(({ r, i }) => {
                const isIn = r.investment_included !== false;
                return (
                  <div key={i} className={cn('flex gap-3', !isIn && 'opacity-60')}>
                    {editMode ? (
                      <div className="flex w-8 shrink-0 justify-center pt-2.5">
                        <div className="flex h-6 items-center">
                          <BrandedCheckbox
                            size="lg"
                            checked={isIn}
                            onChange={(checked) => setRow(i, { investment_included: checked })}
                            aria-label={`Include ${r.item_name} in the total`}
                          />
                        </div>
                      </div>
                    ) : null}
                    {isIn || editMode ? (
                      <div className="min-w-0 flex-1">
                        <PriceRow label={r.item_name} amount={rowAmount(r)} caption={rowCaption(r)} muted={!isIn} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {addOnGroups.length > 0 && (
              <div className="mt-5">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">Add-ons</p>
                <div className="divide-y divide-gray-100">
                  {addOnGroups.map((group) => (
                    <div key={group.itemKey} className={cn('flex gap-3', !group.included && 'opacity-60')}>
                      {editMode ? (
                        <div className="flex w-8 shrink-0 justify-center pt-2.5">
                          <div className="flex h-6 items-center">
                            <BrandedCheckbox
                              size="lg"
                              checked={group.included}
                              onChange={(checked) => toggleAddOnInvestmentIncluded(group.itemKey, checked)}
                              aria-label={`Include ${group.name} in the total`}
                            />
                          </div>
                        </div>
                      ) : null}
                      {group.included || editMode ? (
                        <div className="min-w-0 flex-1">
                          {group.lines.map((line, lineIndex) => (
                            <PriceRow
                              key={`${line.itemKey}-${line.unit}`}
                              label={
                                lineIndex === 0
                                  ? group.name
                                  : line.unit === 'monthly'
                                    ? 'Monthly retainer'
                                    : 'One-time implementation'
                              }
                              amount={line.headline}
                              caption={line.caption}
                              muted={!group.included}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(showOneTime || showMonthly) && (included.length > 0 || addOnGroups.some((g) => g.included)) && (
              <div className="mt-6 border-t border-gray-200 pt-5">
                <div className="mt-1 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-4">
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">Total investment</p>
                  <div className="space-y-1">
                    {showOneTime && (
                      <TotalRow
                        label="One-time"
                        amount={
                          oneTimeTotal > 0
                            ? `${formatCurrency(oneTimeTotal)}${oneTimeLabelOnly ? '+' : ''}`
                            : 'Custom'
                        }
                        suffix="total"
                        emphasis
                      />
                    )}
                    {showMonthly && (
                      <TotalRow
                        label="Monthly"
                        amount={
                          monthlyTotal > 0
                            ? `${formatCurrency(monthlyTotal)}${monthlyLabelOnly ? '+' : ''}`
                            : 'Custom'
                        }
                        suffix="/mo"
                        emphasis
                      />
                    )}
                  </div>
                  {/* An unestimated row would otherwise vanish into a total that
                      looks complete. Say so instead of quietly undercounting. */}
                  {totals.unpricedCount > 0 && (
                    <p className="mt-3 text-xs text-gray-500">
                      {totals.unpricedCount} item{totals.unpricedCount === 1 ? '' : 's'} still to be scoped, so the one-time
                      total will rise.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
