/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  buildInvestmentLineItems,
  computeInvestmentTotals,
  isAddOnInvestmentIncluded,
  shouldShowInvestmentTotal,
} from './investment-summary';
import type { RevenueOpportunityAddOnItem } from './types';

function item(partial: Partial<RevenueOpportunityAddOnItem> & Pick<RevenueOpportunityAddOnItem, 'template_slug' | 'name'>): RevenueOpportunityAddOnItem {
  return {
    bullets: [],
    revenue_monthly: 0,
    display_order: 10,
    ...partial,
  };
}

describe('investment summary', () => {
  it('defaults add-ons to included in the proposal', () => {
    expect(isAddOnInvestmentIncluded(item({ template_slug: 'a', name: 'A' }))).toBe(true);
    expect(isAddOnInvestmentIncluded(item({ template_slug: 'a', name: 'A', investment_included: false }))).toBe(false);
    expect(isAddOnInvestmentIncluded(item({ template_slug: 'a', name: 'A', is_hidden: true }))).toBe(false);
  });

  it('builds line items and totals from priced add-ons', () => {
    const items = [
      item({
        template_slug: 'klaviyo_marketing_analytics',
        name: 'Marketing Analytics',
        one_time_price: 2500,
        display_order: 10,
      }),
      item({
        template_slug: 'klaviyo_helpdesk',
        name: 'Helpdesk',
        one_time_price: 1000,
        monthly_price: 500,
        display_order: 20,
      }),
      item({
        template_slug: 'klaviyo_customer_agent',
        name: 'Customer Agent',
        one_time_price: 2500,
        investment_included: false,
        display_order: 30,
      }),
    ];

    const lines = buildInvestmentLineItems(items);
    expect(lines).toHaveLength(4);

    const totals = computeInvestmentTotals(lines);
    expect(totals.oneTimeTotal).toBe(3500);
    expect(totals.monthlyTotal).toBe(500);
  });

  it('hides zero subtotals unless label-only pricing applies', () => {
    expect(shouldShowInvestmentTotal(0, false)).toBe(false);
    expect(shouldShowInvestmentTotal(0, true)).toBe(true);
    expect(shouldShowInvestmentTotal(2500, false)).toBe(true);
  });
});
