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
} as const;

export const SPAM_BENCHMARK = {
  healthyMax: 0.001,
  warningMax: 0.003,
} as const;

export interface BenchmarkConfig {
  openRateLow: number;
  openRateHigh: number;
  clickRateLow: number;
  clickRateHigh: number;
  recoveryConvLow: number;
  recoveryConvHigh: number;
  standardConvLow: number;
  standardConvHigh: number;
  accountConvLow: number;
  accountConvHigh: number;
  bounceHealthyMax: number;
  bounceWarningMax: number;
  spamHealthyMax: number;
  spamWarningMax: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  openRateLow: OPEN_RATE_BENCHMARK.low,
  openRateHigh: OPEN_RATE_BENCHMARK.high,
  clickRateLow: CLICK_RATE_BENCHMARK.low,
  clickRateHigh: CLICK_RATE_BENCHMARK.high,
  recoveryConvLow: RECOVERY_CONV_BENCHMARK.low,
  recoveryConvHigh: RECOVERY_CONV_BENCHMARK.high,
  standardConvLow: STANDARD_CONV_BENCHMARK.low,
  standardConvHigh: STANDARD_CONV_BENCHMARK.high,
  accountConvLow: ACCOUNT_CONV_BENCHMARK.low,
  accountConvHigh: ACCOUNT_CONV_BENCHMARK.high,
  bounceHealthyMax: BOUNCE_BENCHMARK.healthyMax,
  bounceWarningMax: BOUNCE_BENCHMARK.warningMax,
  spamHealthyMax: SPAM_BENCHMARK.healthyMax,
  spamWarningMax: SPAM_BENCHMARK.warningMax,
};

const BENCHMARK_CONFIG_KEYS = Object.keys(DEFAULT_BENCHMARK_CONFIG) as (keyof BenchmarkConfig)[];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function resolveBenchmarkConfig(raw?: Partial<BenchmarkConfig> | null): BenchmarkConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BENCHMARK_CONFIG };
  const resolved = { ...DEFAULT_BENCHMARK_CONFIG };
  for (const key of BENCHMARK_CONFIG_KEYS) {
    const value = raw[key];
    if (isFiniteNumber(value) && value >= 0) {
      resolved[key] = value;
    }
  }
  return resolved;
}

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

export function getFlowBenchmarks(
  flowName: string,
  config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG,
): FlowBenchmarkSet {
  const nonRevenue = isNonRevenueFlow(flowName);
  const recovery = !nonRevenue && isHighIntentRecoveryFlow(flowName);
  const convLow = recovery ? config.recoveryConvLow : config.standardConvLow;
  const convHigh = recovery ? config.recoveryConvHigh : config.standardConvHigh;

  return {
    openRateLow: config.openRateLow,
    openRateHigh: config.openRateHigh,
    clickRateLow: config.clickRateLow,
    clickRateHigh: config.clickRateHigh,
    convRateLow: nonRevenue ? 0 : convLow,
    convRateHigh: nonRevenue ? 0 : convHigh,
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

function formatHealthyBenchmarkUnder(max: number): string {
  return `Healthy benchmark: under ${formatPctDecimal(max)}`;
}

function formatDeliverabilityWarningRange(healthyMax: number, warningMax: number): string {
  return `Warning: ${formatBenchmarkRange(healthyMax, warningMax)} · Concerning: above ${formatPctDecimal(warningMax)}`;
}

export function buildBenchmarkReferenceBlock(config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG): string {
  return [
    "ECD Klaviyo benchmark reference (use whenever citing a percentage):",
    `- Open rate: healthy ${formatBenchmarkRange(config.openRateLow, config.openRateHigh)} (Apple MPP inflates opens)`,
    `- Click rate: healthy ${formatBenchmarkRange(config.clickRateLow, config.clickRateHigh)}`,
    `- Conversion (placed order), high-intent recovery (Abandoned Cart/Checkout, Browse Abandonment): ${formatBenchmarkRange(config.recoveryConvLow, config.recoveryConvHigh)}`,
    `- Conversion, other revenue flows (Welcome, Post-Purchase, Winback, etc.): ${formatBenchmarkRange(config.standardConvLow, config.standardConvHigh)}`,
    "- Non-revenue/engagement-only flows: judge on open/click only; conversion N/A",
    `- Account weighted flow conversion: ${formatBenchmarkRange(config.accountConvLow, config.accountConvHigh)}`,
    `- Bounce rate: ${formatHealthyBenchmarkUnder(config.bounceHealthyMax)}; ${formatDeliverabilityWarningRange(config.bounceHealthyMax, config.bounceWarningMax)}`,
    `- Spam/complaint rate: ${formatHealthyBenchmarkUnder(config.spamHealthyMax)}; ${formatDeliverabilityWarningRange(config.spamHealthyMax, config.spamWarningMax)}`,
    "When citing any percentage, state the relevant benchmark range and whether the result is within benchmark, below benchmark, elevated, or needs attention.",
  ].join("\n");
}

export async function fetchPlatformBenchmarkConfig(
  supabase: { from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { single: () => Promise<{ data: { benchmarks?: Partial<BenchmarkConfig> | null } | null; error: unknown }> } } } },
): Promise<BenchmarkConfig> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("benchmarks")
      .eq("id", "default")
      .single();
    if (error || !data) return { ...DEFAULT_BENCHMARK_CONFIG };
    return resolveBenchmarkConfig(data.benchmarks ?? null);
  } catch {
    return { ...DEFAULT_BENCHMARK_CONFIG };
  }
}
