import { formatCurrency } from './revenue-calculator';
import type { RevenueOpportunityAddOnItem } from './types';

export type AddOnPriceUnit = 'one_time' | 'monthly';

export type AddOnPricingSlice = {
  item: RevenueOpportunityAddOnItem;
  unit: AddOnPriceUnit;
  amount: number | null;
  label: string | null;
};

function hasOneTimePricing(item: Pick<RevenueOpportunityAddOnItem, 'one_time_price' | 'one_time_label'>): boolean {
  const amount = item.one_time_price;
  const label = item.one_time_label?.trim();
  return (amount != null && Number.isFinite(Number(amount)) && Number(amount) > 0) || Boolean(label);
}

function hasMonthlyPricing(item: Pick<RevenueOpportunityAddOnItem, 'monthly_price' | 'monthly_label'>): boolean {
  const amount = item.monthly_price;
  const label = item.monthly_label?.trim();
  return (amount != null && Number.isFinite(Number(amount)) && Number(amount) > 0) || Boolean(label);
}

export function addOnHasPricing(item: RevenueOpportunityAddOnItem): boolean {
  return hasOneTimePricing(item) || hasMonthlyPricing(item);
}

export function splitAddOnsByPricing(items: RevenueOpportunityAddOnItem[]): {
  oneTime: AddOnPricingSlice[];
  monthly: AddOnPricingSlice[];
  /** Visible in report but no one-time/monthly price set (e.g. Klaviyo platform add-ons). */
  unpriced: AddOnPricingSlice[];
} {
  const oneTime: AddOnPricingSlice[] = [];
  const monthly: AddOnPricingSlice[] = [];
  const unpriced: AddOnPricingSlice[] = [];

  for (const item of items) {
    if (hasOneTimePricing(item)) {
      oneTime.push({
        item,
        unit: 'one_time',
        amount: item.one_time_price != null ? Number(item.one_time_price) : null,
        label: item.one_time_label?.trim() || null,
      });
    }
    if (hasMonthlyPricing(item)) {
      monthly.push({
        item,
        unit: 'monthly',
        amount: item.monthly_price != null ? Number(item.monthly_price) : null,
        label: item.monthly_label?.trim() || null,
      });
    }
    if (!addOnHasPricing(item)) {
      unpriced.push({ item, unit: 'one_time', amount: null, label: null });
    }
  }

  return { oneTime, monthly, unpriced };
}

export function formatAddOnPrice(
  amount: number | null | undefined,
  label: string | null | undefined,
  unit: AddOnPriceUnit,
): { headline: string; caption: string } {
  const trimmedLabel = label?.trim();
  if (trimmedLabel && (amount == null || !Number.isFinite(amount) || amount <= 0)) {
    return {
      headline: trimmedLabel,
      caption: unit === 'monthly' ? 'per month' : 'one-time',
    };
  }
  if (amount != null && Number.isFinite(amount) && amount > 0) {
    return {
      headline: formatCurrency(amount),
      caption: trimmedLabel || (unit === 'monthly' ? 'per month' : 'one-time'),
    };
  }
  return { headline: '—', caption: unit === 'monthly' ? 'per month' : 'one-time' };
}

export function addOnPricingKey(item: RevenueOpportunityAddOnItem, unit: AddOnPriceUnit): string {
  return `${item.template_slug}-${item.display_order}-${unit}`;
}
