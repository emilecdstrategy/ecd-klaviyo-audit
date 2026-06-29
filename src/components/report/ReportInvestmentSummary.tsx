import { Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  buildInvestmentLineItems,
  computeInvestmentTotals,
  formatInvestmentTotal,
  groupInvestmentLinesByItem,
} from '../../lib/investment-summary';
import type { RevenueOpportunityAddOnItem } from '../../lib/types';
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

function InvestmentToggle({
  included,
  onToggle,
  label,
}: {
  included: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={included ? `Remove ${label} from proposal` : `Include ${label} in proposal`}
      aria-pressed={included}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
        included
          ? 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/15'
          : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600',
      )}
    >
      <span className="sr-only">{included ? 'Included in proposal' : 'Excluded from proposal'}</span>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        {included ? (
          <path
            d="M3 8.5 6.5 12 13 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
    </button>
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
  const { editMode, toggleAddOnInvestmentIncluded } = useReportEdit();
  const lineItems = buildInvestmentLineItems(items);
  const totals = computeInvestmentTotals(lineItems);
  const groups = groupInvestmentLinesByItem(lineItems);

  const visibleGroups = editMode
    ? groups
    : groups.filter(group => group.included);

  if (!editMode && hidden) return null;
  if (!editMode && visibleGroups.length === 0) return null;

  const canEditCopy = editMode && Boolean(onSaveTitle);
  const canToggleItems = editMode;
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
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  {canToggleItems && <th className="w-10 pb-3 pr-2" />}
                  <th className="pb-3 pr-4 font-bold">Service</th>
                  <th className="pb-3 text-right font-bold">Investment</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map(group => (
                  <tr
                    key={group.itemKey}
                    className={cn(
                      'border-t border-gray-100 first:border-t-0',
                      !group.included && 'opacity-50',
                    )}
                  >
                    {canToggleItems && (
                      <td className="py-4 pr-2 align-top">
                        <InvestmentToggle
                          included={group.included}
                          label={group.name}
                          onToggle={() => toggleAddOnInvestmentIncluded(group.itemKey, !group.included)}
                        />
                      </td>
                    )}
                    <td className="py-4 pr-4 align-top">
                      <p
                        className={cn(
                          'text-base font-medium text-gray-900',
                          !group.included && 'line-through decoration-gray-300',
                        )}
                      >
                        {group.name}
                      </p>
                      {group.lines.length > 1 && (
                        <ul className="mt-1 space-y-0.5">
                          {group.lines.map(line => (
                            <li key={`${line.itemKey}-${line.unit}`} className="text-xs text-gray-500">
                              {line.unit === 'monthly' ? 'Monthly retainer' : 'One-time implementation'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-4 text-right align-top">
                      <div className="space-y-2">
                        {group.lines.map(line => (
                          <div key={`${line.itemKey}-${line.unit}`}>
                            <p
                              className={cn(
                                'text-base font-semibold tabular-nums text-gray-900',
                                !group.included && 'line-through decoration-gray-300',
                              )}
                            >
                              {line.headline}
                            </p>
                            <p className="text-xs text-gray-500">{line.caption}</p>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {hasOneTime && (
                  <tr className="border-t border-gray-200">
                    <td
                      colSpan={canToggleItems ? 2 : 1}
                      className="pt-5 pr-4 text-sm font-semibold text-gray-700"
                    >
                      One-time total
                    </td>
                    <td className="pt-5 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatInvestmentTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly, 'one_time')}
                    </td>
                  </tr>
                )}
                {hasMonthly && (
                  <tr>
                    <td
                      colSpan={canToggleItems ? 2 : 1}
                      className="pt-3 pr-4 text-sm font-semibold text-gray-700"
                    >
                      Monthly total
                    </td>
                    <td className="pt-3 text-right text-sm font-semibold tabular-nums text-gray-900">
                      {formatInvestmentTotal(totals.monthlyTotal, totals.monthlyHasLabelOnly, 'monthly')}
                      {totals.monthlyTotal > 0 && (
                        <span className="ml-1 text-xs font-medium text-gray-500">/mo</span>
                      )}
                    </td>
                  </tr>
                )}
                {(hasOneTime || hasMonthly) && (
                  <tr className="border-t-2 border-gray-900/10">
                    <td
                      colSpan={canToggleItems ? 2 : 1}
                      className="pt-4 pr-4 text-base font-bold text-gray-900"
                    >
                      Proposal total
                    </td>
                    <td className="pt-4 text-right">
                      <div className="space-y-1">
                        {hasOneTime && (
                          <p className="text-xl font-extrabold tabular-nums tracking-tight text-gray-900">
                            {formatInvestmentTotal(totals.oneTimeTotal, totals.oneTimeHasLabelOnly, 'one_time')}
                            <span className="ml-1 text-sm font-semibold text-gray-500">one-time</span>
                          </p>
                        )}
                        {hasMonthly && (
                          <p className="text-xl font-extrabold tabular-nums tracking-tight text-gray-900">
                            {formatInvestmentTotal(totals.monthlyTotal, totals.monthlyHasLabelOnly, 'monthly')}
                            <span className="ml-1 text-sm font-semibold text-gray-500">/mo</span>
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {canToggleItems && (
          <p className="mt-4 text-xs text-gray-500">
            Toggle line items on or off while presenting — totals update immediately and save to this audit.
          </p>
        )}
      </div>
    </div>
  );

  if (!editMode || !onToggleHidden) return body;

  return (
    <ReportBlockEditChrome
      label="Investment Summary"
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      className="mt-6"
    >
      {!hidden ? body : null}
    </ReportBlockEditChrome>
  );
}
