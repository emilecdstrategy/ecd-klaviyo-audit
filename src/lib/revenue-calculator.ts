import { isRevenueOpportunitySectionVisible } from './report-config/resolve';

// Re-exported for existing importers; the helper itself lives on its own to
// keep benchmarks.ts out of an import cycle (see non-revenue-flows.ts).
export { isNonRevenueFlow } from './non-revenue-flows';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

/** Audit sections that contribute to the revenue opportunity total and banner breakdown. */
export const REVENUE_OPPORTUNITY_SECTION_KEYS = [
  'flows',
  'segmentation',
  'campaigns',
  'signup_forms',
  'email_design',
] as const;

export type RevenueOpportunitySectionKey = (typeof REVENUE_OPPORTUNITY_SECTION_KEYS)[number];

export function isRevenueOpportunitySection(sectionKey: string): sectionKey is RevenueOpportunitySectionKey {
  return (REVENUE_OPPORTUNITY_SECTION_KEYS as readonly string[]).includes(sectionKey);
}

/** Default email design $/mo when AI returns zero: at least $300 or 10% of total identified opportunity (excl. email design). */
export function defaultEmailDesignRevenue(totalOpportunityExcludingEmailDesign: number): number {
  return Math.max(300, Math.round(totalOpportunityExcludingEmailDesign * 0.1));
}

type RevenueSectionLike = {
  revenue_opportunity?: number;
  section_key?: string;
  section_config?: Record<string, unknown> | null;
};

export function computeAuditTotalRevenueOpportunity(
  sections: RevenueSectionLike[],
  _layout?: unknown,
): number {
  const sectionTotal = sections
    .filter(section => section.section_key && isRevenueOpportunitySection(section.section_key))
    .filter(section =>
      isRevenueOpportunitySectionVisible(
        section.section_key!,
        section.section_config ?? null,
      ),
    )
    .reduce((sum, section) => sum + (Number(section.revenue_opportunity) || 0), 0);
  return sectionTotal;
}
