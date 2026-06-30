import { addOnItemKey } from './addon-highlight';
import { addOnHasPricing, formatAddOnPrice, splitAddOnsByPricing, type AddOnPriceUnit } from './addon-pricing';
import { formatCurrency } from './revenue-calculator';
import type { RevenueOpportunityAddOnItem } from './types';

export type InvestmentLineItem = {
  itemKey: string;
  name: string;
  unit: AddOnPriceUnit;
  amount: number | null;
  label: string | null;
  headline: string;
  caption: string;
  included: boolean;
  displayOrder: number;
};

export type InvestmentTotals = {
  oneTimeTotal: number;
  monthlyTotal: number;
  oneTimeHasLabelOnly: boolean;
  monthlyHasLabelOnly: boolean;
};

export function isAddOnInvestmentIncluded(item: RevenueOpportunityAddOnItem): boolean {
  if (item.is_hidden) return false;
  return item.investment_included !== false;
}

export function buildInvestmentLineItems(items: RevenueOpportunityAddOnItem[]): InvestmentLineItem[] {
  const visible = items
    .filter(item => !item.is_hidden && addOnHasPricing(item))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const { oneTime, monthly } = splitAddOnsByPricing(visible);
  const lines: InvestmentLineItem[] = [];

  const pushSlice = (slice: (typeof oneTime)[number]) => {
    const { headline, caption } = formatAddOnPrice(slice.amount, slice.label, slice.unit);
    lines.push({
      itemKey: addOnItemKey(slice.item),
      name: slice.item.name,
      unit: slice.unit,
      amount: slice.amount,
      label: slice.label,
      headline,
      caption,
      included: isAddOnInvestmentIncluded(slice.item),
      displayOrder: slice.item.display_order ?? 0,
    });
  };

  for (const slice of oneTime) pushSlice(slice);
  for (const slice of monthly) pushSlice(slice);

  return lines.sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    if (a.itemKey !== b.itemKey) return a.itemKey.localeCompare(b.itemKey);
    return a.unit === 'one_time' ? -1 : 1;
  });
}

export function computeInvestmentTotals(lines: InvestmentLineItem[]): InvestmentTotals {
  let oneTimeTotal = 0;
  let monthlyTotal = 0;
  let oneTimeHasLabelOnly = false;
  let monthlyHasLabelOnly = false;

  for (const line of lines) {
    if (!line.included) continue;
    const hasNumeric = line.amount != null && Number.isFinite(line.amount) && line.amount > 0;
    if (line.unit === 'one_time') {
      if (hasNumeric) oneTimeTotal += line.amount!;
      else if (line.label) oneTimeHasLabelOnly = true;
    } else if (hasNumeric) monthlyTotal += line.amount!;
    else if (line.label) monthlyHasLabelOnly = true;
  }

  return { oneTimeTotal, monthlyTotal, oneTimeHasLabelOnly, monthlyHasLabelOnly };
}

export function formatInvestmentTotal(
  total: number,
  hasLabelOnly: boolean,
  unit: AddOnPriceUnit,
): string {
  if (total > 0) return formatCurrency(total);
  if (hasLabelOnly) return 'See line items';
  return formatCurrency(0);
}

/** Whether to show a one-time or monthly subtotal row (hide when $0 with no label-only items). */
export function shouldShowInvestmentTotal(total: number, hasLabelOnly: boolean): boolean {
  return total > 0 || hasLabelOnly;
}

export function groupInvestmentLinesByItem(
  lines: InvestmentLineItem[],
): Array<{ itemKey: string; name: string; included: boolean; lines: InvestmentLineItem[] }> {
  const groups: Array<{ itemKey: string; name: string; included: boolean; lines: InvestmentLineItem[] }> = [];
  const indexByKey = new Map<string, number>();

  for (const line of lines) {
    const existingIndex = indexByKey.get(line.itemKey);
    if (existingIndex == null) {
      indexByKey.set(line.itemKey, groups.length);
      groups.push({
        itemKey: line.itemKey,
        name: line.name,
        included: line.included,
        lines: [line],
      });
      continue;
    }
    groups[existingIndex].lines.push(line);
  }

  return groups;
}
