import { Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  buildInvestmentLineItems,
  computeInvestmentTotals,
  formatInvestmentTotal,
  groupInvestmentLinesByItem,
} from '../../lib/investment-summary';
import type { RevenueOpportunityAddOnItem } from '../../lib/types';
import BrandedCheckbox from '../ui/BrandedCheckbox';
import ReportBlockHeader from './ReportBlockHeader';
import ReportBlockEditChrome from './edit/ReportBlockEditChrome';
import EditablePlainText from './edit/EditablePlainText';
import { useReportEdit } from './edit/ReportEditContext';

type ReportInvestmentSummaryProps = {
  items: RevenueOpportunityAddOnItem[];
  title: string;
  subtitle?: string;
  hidden?: boolean;
  onToggleHidden?: (hidden: boolean) => void;
  onSaveTitle?: (value: string) => void;
  onSaveSubtitle?: (value: string) => void;
};

function MenuPriceRow({
  label,
  amount,
  caption,
  muted = false,
  labelClassName,
}: {
  label: string;
  amount: string;
  caption?: string;
  muted?: boolean;
  labelClassName?: string;
}) {
  return (
    <div className={cn('py-2.5', muted && 'opacity-50')}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            'max-w-[58%] shrink-0 text-base font-medium leading-snug text-gray-900',
            muted && 'line-through decoration-gray-300',
            labelClassName,
          )}
        >
          {label}
        </span>
        <span
          className="min-w-[1.5rem] flex-1 translate-y-[-0.15em] border-b border-dotted border-gray-300"
          aria-hidden
        />
        <span
          className={cn(
            'shrink-0 text-right text-base font-semibold tabular-nums text-gray-900',
            muted && 'line-through decoration-gray-300',
          )}
        >
          {amount}
        </span>
      </div>
      {caption ? (
        <p className="mt-0.5 text-right text-xs text-gray-500">{caption}</p>
      ) : null}
    </div>
  );
}

function SummaryTotalRow({
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
      <span
        className={cn(
          'shrink-0 text-gray-700',
          emphasis ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'min-w-[1.5rem] flex-1 translate-y-[-0.12em] border-b border-dotted',
          emphasis ? 'border-gray-400' : 'border-gray-300',
        )}
        aria-hidden
      />
      <span
        className={cn(
          'shrink-0 text-right tabular-nums text-gray-900',
          emphasis ? 'text-xl font-extrabold tracking-tight' : 'text-sm font-semibold',
        )}
      >
        {amount}
        {suffix ? (
          <span className={cn('ml-1 font-medium text-gray-500', emphasis ? 'text-sm' : 'text-xs')}>
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export default function ReportInvestmentSummary({
  items,
  title,
  subtitle,
  hidden = false,
  onToggleHidden,
  onSaveTitle,
  onSaveSubtitle,
}: ReportInvestmentSummaryProps) {
  const { editMode, investmentToggleMode, toggleAddOnInvestmentIncluded } = useReportEdit();
  const lineItems = buildInvestmentLineItems(items);
  const totals = computeInvestmentTotals(lineItems);
  const groups = groupInvestmentLinesByItem(lineItems);
  const canToggleItems = editMode || investmentToggleMode;

  const visibleGroups = canToggleItems
    ? groups
    : groups.filter(group => group.included);

  if (!editMode && hidden) return null;
  if (!canToggleItems && visibleGroups.length === 0) return null;

  const canEditCopy = editMode && Boolean(onSaveTitle);
  const hasOneTime = lineItems.some(line => line.unit === 'one_time');
  const hasMonthly = lineItems.some(line => line.unit === 'monthly');

  const body = (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <ReportBlockHeader
        className="border-b border-gray-200 bg-gray-50 px-6 py-4"
        icon={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 ring-1 ring-brand-primary/15">
            <Receipt className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
          </div>
        }
        title={
          canEditCopy ? (
            <EditablePlainText
              value={title}
              onSave={onSaveTitle!}
              className="text-lg font-bold text-gray-900"
              as="span"
            />
          ) : (
            <span className="text-lg font-bold text-gray-900">{title}</span>
          )
        }
        subtitle={
          canEditCopy ? (
            <EditablePlainText
              value={(subtitle ?? '').trim() || 'ECD implementation and retainer fees for services discussed in this audit.'}
              onSave={onSaveSubtitle!}
              className="text-sm text-gray-500"
              as="span"
            />
          ) : (
            subtitle ? <span className="text-sm text-gray-500">{subtitle}</span> : null
          )
        }
        titleClassName="text-lg font-bold text-gray-900"
      />

      <div className="px-6 py-5">
        {visibleGroups.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No priced add-ons included in this proposal yet.
          </p>
        ) : (
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
              {canToggleItems ? <span className="w-8 shrink-0" aria-hidden /> : null}
              <span className="flex-1">Service</span>
              <span className="shrink-0">Investment</span>
            </div>

            <div className="divide-y divide-gray-100">
              {visibleGroups.map(group => (
                <div
                  key={group.itemKey}
                  className={cn(
                    'flex gap-3 py-1',
                    !group.included && 'opacity-60',
                  )}
                >
                  {canToggleItems ? (
                    <div className="pt-2.5">
                      <BrandedCheckbox
                        size="lg"
                        checked={group.included}
                        onChange={checked => toggleAddOnInvestmentIncluded(group.itemKey, checked)}
                        aria-label={`Include ${group.name} in proposal`}
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    {group.lines.map((line, lineIndex) => (
                      <MenuPriceRow
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
                        labelClassName={lineIndex > 0 ? 'pl-3 text-sm font-normal text-gray-600' : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {(hasOneTime || hasMonthly) && (
              <div className="mt-6 border-t border-gray-200 pt-5">
                <div className="space-y-1">
                  {hasOneTime && (
                    <SummaryTotalRow
                      label="One-time total"
                      amount={formatInvestmentTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly, 'one_time')}
                    />
                  )}
                  {hasMonthly && (
                    <SummaryTotalRow
                      label="Monthly total"
                      amount={formatInvestmentTotal(totals.monthlyTotal, totals.monthlyHasLabelOnly, 'monthly')}
                      suffix={totals.monthlyTotal > 0 ? '/mo' : undefined}
                    />
                  )}
                </div>

                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-4">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Proposal total
                  </p>
                  <div className="space-y-1">
                    {hasOneTime && (
                      <SummaryTotalRow
                        label="One-time"
                        amount={formatInvestmentTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly, 'one_time')}
                        suffix="total"
                        emphasis
                      />
                    )}
                    {hasMonthly && (
                      <SummaryTotalRow
                        label="Monthly"
                        amount={formatInvestmentTotal(totals.monthlyTotal, totals.monthlyHasLabelOnly, 'monthly')}
                        suffix="/mo"
                        emphasis
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );

  const wrapperClass = 'mt-12';

  if (!editMode || !onToggleHidden) {
    return <div className={wrapperClass}>{body}</div>;
  }

  return (
    <ReportBlockEditChrome
      label="Investment Summary"
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      className={wrapperClass}
    >
      {!hidden ? body : null}
    </ReportBlockEditChrome>
  );
}
