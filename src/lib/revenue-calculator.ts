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
