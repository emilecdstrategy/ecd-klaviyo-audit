import { isRevenueOpportunitySectionVisible } from './report-config/resolve';

const NON_REVENUE_FLOW_PATTERNS = [
  /review\s*request/i,
  /review\s*follow/i,
  /feedback/i,
  /survey/i,
  /nps/i,
  /sunset/i,
  /list\s*clean/i,
  /order\s*confirm/i,
  /order\s*notif/i,
  /shipping/i,
  /delivery/i,
  /fulfillment/i,
  /transactional/i,
  /password\s*reset/i,
  /account\s*confirm/i,
  /double\s*opt/i,
];

export function isNonRevenueFlow(flowName: string): boolean {
  return NON_REVENUE_FLOW_PATTERNS.some(p => p.test(flowName));
}

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

type RevenueAddOnLike = {
  revenue_monthly?: number;
  is_hidden?: boolean;
};

type RevenueSectionLike = {
  revenue_opportunity?: number;
  section_key?: string;
  section_config?: Record<string, unknown> | null;
};

export function computeAuditTotalRevenueOpportunity(
  sections: RevenueSectionLike[],
  layout: unknown,
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
  const layoutObj = (layout as Record<string, unknown> | null | undefined) ?? {};
  const revenueSummary = layoutObj.revenue_summary as Record<string, unknown> | undefined;
  const blocks = revenueSummary?.blocks as Record<string, unknown> | undefined;
  const addOns = blocks?.addOns as Record<string, unknown> | undefined;
  const items = Array.isArray(addOns?.items) ? (addOns.items as RevenueAddOnLike[]) : [];
  const addOnTotal = items
    .filter(item => item && !item.is_hidden)
    .reduce((sum, item) => sum + (Number(item.revenue_monthly) || 0), 0);
  return sectionTotal + addOnTotal;
}
