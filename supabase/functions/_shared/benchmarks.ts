/** Keep in sync with src/lib/benchmarks.ts */

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

export const OPEN_RATE_BENCHMARK = { low: 0.25, high: 0.45 } as const;
export const CLICK_RATE_BENCHMARK = { low: 0.02, high: 0.05 } as const;
export const RECOVERY_CONV_BENCHMARK = { low: 0.02, high: 0.06 } as const;
export const STANDARD_CONV_BENCHMARK = { low: 0.01, high: 0.03 } as const;
export const ACCOUNT_CONV_BENCHMARK = { low: 0.01, high: 0.03 } as const;

export const BOUNCE_BENCHMARK = {
  healthyMax: 0.02,
  warningMax: 0.05,
  label: "Healthy: under 2%",
} as const;

export const SPAM_BENCHMARK = {
  healthyMax: 0.001,
  warningMax: 0.003,
  label: "Healthy: under 0.1%",
} as const;

const HIGH_INTENT_RECOVERY_PATTERNS = [
  /abandon(ed)?\s*(cart|checkout)/i,
  /cart\s*abandon/i,
  /checkout\s*abandon/i,
  /checkout\s*recovery/i,
  /browse\s*abandon/i,
];

export type FlowBenchmarkTier = "recovery" | "standard" | "non_revenue";

export interface FlowBenchmarkSet {
  openRateLow: number;
  openRateHigh: number;
  clickRateLow: number;
  clickRateHigh: number;
  convRateLow: number;
  convRateHigh: number;
  convApplicable: boolean;
  tier: FlowBenchmarkTier;
  tierLabel: string;
}

function isNonRevenueFlow(flowName: string): boolean {
  return NON_REVENUE_FLOW_PATTERNS.some((p) => p.test(flowName));
}

function isHighIntentRecoveryFlow(flowName: string): boolean {
  return HIGH_INTENT_RECOVERY_PATTERNS.some((p) => p.test(flowName));
}

export function getFlowBenchmarks(flowName: string): FlowBenchmarkSet {
  const nonRevenue = isNonRevenueFlow(flowName);
  const recovery = !nonRevenue && isHighIntentRecoveryFlow(flowName);
  const conv = recovery ? RECOVERY_CONV_BENCHMARK : STANDARD_CONV_BENCHMARK;

  return {
    openRateLow: OPEN_RATE_BENCHMARK.low,
    openRateHigh: OPEN_RATE_BENCHMARK.high,
    clickRateLow: CLICK_RATE_BENCHMARK.low,
    clickRateHigh: CLICK_RATE_BENCHMARK.high,
    convRateLow: nonRevenue ? 0 : conv.low,
    convRateHigh: nonRevenue ? 0 : conv.high,
    convApplicable: !nonRevenue,
    tier: nonRevenue ? "non_revenue" : recovery ? "recovery" : "standard",
    tierLabel: nonRevenue
      ? "engagement-only (open/click)"
      : recovery
        ? "high-intent recovery flow"
        : "revenue flow",
  };
}

function formatPctDecimal(n: number): string {
  const pct = n * 100;
  if (pct <= 0) return "0%";
  if (pct < 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
}

export function formatBenchmarkRange(low: number, high: number): string {
  if (low <= 0 && high <= 0) return "N/A";
  return `${formatPctDecimal(low)}–${formatPctDecimal(high)}`;
}

export function buildBenchmarkReferenceBlock(): string {
  return [
    "ECD Klaviyo benchmark reference (use whenever citing a percentage):",
    `- Open rate: healthy ${formatBenchmarkRange(OPEN_RATE_BENCHMARK.low, OPEN_RATE_BENCHMARK.high)} (Apple MPP inflates opens)`,
    `- Click rate: healthy ${formatBenchmarkRange(CLICK_RATE_BENCHMARK.low, CLICK_RATE_BENCHMARK.high)}`,
    `- Conversion (placed order), high-intent recovery (Abandoned Cart/Checkout, Browse Abandonment): ${formatBenchmarkRange(RECOVERY_CONV_BENCHMARK.low, RECOVERY_CONV_BENCHMARK.high)}`,
    `- Conversion, other revenue flows (Welcome, Post-Purchase, Winback, etc.): ${formatBenchmarkRange(STANDARD_CONV_BENCHMARK.low, STANDARD_CONV_BENCHMARK.high)}`,
    "- Non-revenue/engagement-only flows: judge on open/click only; conversion N/A",
    `- Account weighted flow conversion: ${formatBenchmarkRange(ACCOUNT_CONV_BENCHMARK.low, ACCOUNT_CONV_BENCHMARK.high)}`,
    `- Bounce rate: ${BOUNCE_BENCHMARK.label}; warning 2–5%; concerning above 5%`,
    `- Spam/complaint rate: ${SPAM_BENCHMARK.label}; warning 0.1–0.3%; concerning above 0.3%`,
    "When citing any percentage, state the relevant benchmark range and whether the result is healthy, below benchmark, or needs attention.",
  ].join("\n");
}
