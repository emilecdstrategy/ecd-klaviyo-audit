interface CalcInputs {
  listSize: number;
  aov: number;
  monthlyTraffic: number;
  currentPopupCvr?: number;
}

interface FlowBenchmark {
  name: string;
  low: number;
  high: number;
  key: string;
}

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

const FLOW_BENCHMARKS: FlowBenchmark[] = [
  { name: 'Abandoned Cart', low: 150, high: 300, key: 'abandoned_cart' },
  { name: 'Browse Abandonment', low: 80, high: 150, key: 'browse_abandonment' },
  { name: 'Welcome Series', low: 100, high: 200, key: 'welcome_series' },
  { name: 'Post-Purchase', low: 60, high: 120, key: 'post_purchase' },
  { name: 'Winback / Re-engagement', low: 40, high: 80, key: 'winback' },
];

const OPTIMIZED_POPUP_CVR = 0.055;
const BASIC_POPUP_CVR = 0.01;
const EMAIL_REVENUE_RATE = 0.05;

export function calculateFlowOpportunity(listSize: number): { name: string; low: number; high: number; mid: number }[] {
  const factor = listSize / 1000;
  return FLOW_BENCHMARKS.map(b => ({
    name: b.name,
    low: Math.round(b.low * factor),
    high: Math.round(b.high * factor),
    mid: Math.round(((b.low + b.high) / 2) * factor),
  }));
}

export function calculateFormOpportunity(inputs: CalcInputs): number {
  const currentCvr = inputs.currentPopupCvr ?? BASIC_POPUP_CVR;
  const uplift = OPTIMIZED_POPUP_CVR - currentCvr;
  if (uplift <= 0) return 0;
  return Math.round(uplift * inputs.monthlyTraffic * inputs.aov * EMAIL_REVENUE_RATE);
}

export function calculateTotalOpportunity(inputs: CalcInputs): {
  flows: { name: string; low: number; high: number; mid: number }[];
  formOpportunity: number;
  totalLow: number;
  totalHigh: number;
  totalMid: number;
} {
  const flows = calculateFlowOpportunity(inputs.listSize);
  const formOpportunity = calculateFormOpportunity(inputs);
  const flowTotalLow = flows.reduce((s, f) => s + f.low, 0);
  const flowTotalHigh = flows.reduce((s, f) => s + f.high, 0);
  const flowTotalMid = flows.reduce((s, f) => s + f.mid, 0);

  return {
    flows,
    formOpportunity,
    totalLow: flowTotalLow + formOpportunity,
    totalHigh: flowTotalHigh + formOpportunity,
    totalMid: flowTotalMid + formOpportunity,
  };
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
};

export function computeAuditTotalRevenueOpportunity(
  sections: RevenueSectionLike[],
  layout: unknown,
): number {
  const sectionTotal = sections
    .filter(section => section.section_key && isRevenueOpportunitySection(section.section_key))
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
