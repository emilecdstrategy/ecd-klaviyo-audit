import { isNonRevenueFlow } from './revenue-calculator';

/** Canonical Klaviyo email/flow benchmark bands (decimal rates, e.g. 0.25 = 25%). */
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
  return typeof value === 'number' && Number.isFinite(value);
}

/** Merge partial DB JSON with canonical defaults. */
export function resolveBenchmarkConfig(raw?: Partial<BenchmarkConfig> | null): BenchmarkConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BENCHMARK_CONFIG };
  const resolved = { ...DEFAULT_BENCHMARK_CONFIG };
  for (const key of BENCHMARK_CONFIG_KEYS) {
    const value = raw[key];
    if (isFiniteNumber(value) && value >= 0) {
      resolved[key] = value;
    }
  }
  return resolved;
}

export const REVENUE_TIERS = [
  { min: 500_000, label: 'Strong' },
  { min: 300_000, label: 'Good' },
  { min: 200_000, label: 'Moderate' },
  { min: 100_000, label: 'Needs work' },
  { min: 50_000, label: 'Starter' },
] as const;

/** Used by flows health score config — mirrors OPEN/CLICK canonical bands. */
export function buildFlowsHealthBenchmarks(config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG) {
  return {
    openRateLow: config.openRateLow,
    openRateHigh: config.openRateHigh,
    clickRateLow: config.clickRateLow,
    clickRateHigh: config.clickRateHigh,
    revenueTiers: [...REVENUE_TIERS],
  } as const;
}

export const DEFAULT_FLOWS_HEALTH_BENCHMARKS = buildFlowsHealthBenchmarks();

const HIGH_INTENT_RECOVERY_PATTERNS = [
  /abandon(ed)?\s*(cart|checkout)/i,
  /cart\s*abandon/i,
  /checkout\s*abandon/i,
  /checkout\s*recovery/i,
  /browse\s*abandon/i,
];

export type MetricStatus = 'good' | 'warning' | 'bad' | 'missing';
export type FlowBenchmarkTier = 'recovery' | 'standard' | 'non_revenue';

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

export function isHighIntentRecoveryFlow(flowName: string): boolean {
  return HIGH_INTENT_RECOVERY_PATTERNS.some(p => p.test(flowName));
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
    tier: nonRevenue ? 'non_revenue' : recovery ? 'recovery' : 'standard',
    tierLabel: nonRevenue
      ? 'engagement-only (open/click)'
      : recovery
        ? 'high-intent recovery flow'
        : 'revenue flow',
  };
}

/** Higher-is-better rate (open, click, conversion). */
export function classifyRate(actual: number | null, low: number, _high?: number): MetricStatus {
  if (actual === null || Number.isNaN(actual)) return 'missing';
  if (actual >= low) return 'good';
  if (actual >= low * 0.7) return 'warning';
  return 'bad';
}

/** Lower-is-better rate (bounce, spam). */
export function classifyDeliverabilityRate(
  actual: number | null,
  healthyMax: number,
  warningMax: number,
): MetricStatus {
  if (actual === null || Number.isNaN(actual)) return 'missing';
  if (actual <= healthyMax) return 'good';
  if (actual <= warningMax) return 'warning';
  return 'bad';
}

export function formatPctDecimal(n: number, opts?: { extraPrecisionBelow?: number }): string {
  const pct = n * 100;
  const threshold = opts?.extraPrecisionBelow ?? 0.01;
  if (pct <= 0) return '0%';
  if (pct < threshold) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
}

export function formatBenchmarkRange(low: number, high: number): string {
  if (low <= 0 && high <= 0) return 'N/A';
  return `${formatPctDecimal(low)}–${formatPctDecimal(high)}`;
}

export function formatBenchmarkSubline(low: number, high: number): string {
  if (low <= 0 && high <= 0) return '';
  return `Benchmark: ${formatBenchmarkRange(low, high)}`;
}

export function formatHealthyBenchmarkUnder(max: number): string {
  return `Healthy benchmark: under ${formatPctDecimal(max)}`;
}

export function formatHealthyBenchmarkRange(low: number, high: number): string {
  return `Healthy benchmark: ${formatBenchmarkRange(low, high)}`;
}

export function formatDeliverabilityWarningRange(healthyMax: number, warningMax: number): string {
  return `Warning: ${formatBenchmarkRange(healthyMax, warningMax)} · Concerning: above ${formatPctDecimal(warningMax)}`;
}

export function formatHealthyLabel(status: MetricStatus): string {
  switch (status) {
    case 'good':
      return 'Healthy';
    case 'warning':
      return 'Below benchmark';
    case 'bad':
      return 'Needs attention';
    default:
      return '';
  }
}

/** Plain-text block for AI prompts — keep in sync with supabase/functions/_shared/benchmarks.ts */
export function buildBenchmarkReferenceBlock(config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG): string {
  return [
    'ECD Klaviyo benchmark reference (use whenever citing a percentage):',
    `- Open rate: healthy ${formatBenchmarkRange(config.openRateLow, config.openRateHigh)} (Apple MPP inflates opens)`,
    `- Click rate: healthy ${formatBenchmarkRange(config.clickRateLow, config.clickRateHigh)}`,
    `- Conversion (placed order), high-intent recovery (Abandoned Cart/Checkout, Browse Abandonment): ${formatBenchmarkRange(config.recoveryConvLow, config.recoveryConvHigh)}`,
    `- Conversion, other revenue flows (Welcome, Post-Purchase, Winback, etc.): ${formatBenchmarkRange(config.standardConvLow, config.standardConvHigh)}`,
    '- Non-revenue/engagement-only flows: judge on open/click only; conversion N/A',
    `- Account weighted flow conversion: ${formatBenchmarkRange(config.accountConvLow, config.accountConvHigh)}`,
    `- Bounce rate: ${formatHealthyBenchmarkUnder(config.bounceHealthyMax)}; ${formatDeliverabilityWarningRange(config.bounceHealthyMax, config.bounceWarningMax)}`,
    `- Spam/complaint rate: ${formatHealthyBenchmarkUnder(config.spamHealthyMax)}; ${formatDeliverabilityWarningRange(config.spamHealthyMax, config.spamWarningMax)}`,
    'When citing any percentage, state the relevant benchmark range and whether the result is within benchmark, below benchmark, elevated, or needs attention.',
  ].join('\n');
}

/** Convert admin form percentages (25 = 25%) to decimal config. */
export function benchmarkFormToConfig(form: BenchmarkFormValues): BenchmarkConfig {
  return {
    openRateLow: form.openRateLow / 100,
    openRateHigh: form.openRateHigh / 100,
    clickRateLow: form.clickRateLow / 100,
    clickRateHigh: form.clickRateHigh / 100,
    recoveryConvLow: form.recoveryConvLow / 100,
    recoveryConvHigh: form.recoveryConvHigh / 100,
    standardConvLow: form.standardConvLow / 100,
    standardConvHigh: form.standardConvHigh / 100,
    accountConvLow: form.accountConvLow / 100,
    accountConvHigh: form.accountConvHigh / 100,
    bounceHealthyMax: form.bounceHealthyMax / 100,
    bounceWarningMax: form.bounceWarningMax / 100,
    spamHealthyMax: form.spamHealthyMax / 100,
    spamWarningMax: form.spamWarningMax / 100,
  };
}

export type BenchmarkFormValues = {
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
};

export function benchmarkConfigToForm(config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG): BenchmarkFormValues {
  return {
    openRateLow: config.openRateLow * 100,
    openRateHigh: config.openRateHigh * 100,
    clickRateLow: config.clickRateLow * 100,
    clickRateHigh: config.clickRateHigh * 100,
    recoveryConvLow: config.recoveryConvLow * 100,
    recoveryConvHigh: config.recoveryConvHigh * 100,
    standardConvLow: config.standardConvLow * 100,
    standardConvHigh: config.standardConvHigh * 100,
    accountConvLow: config.accountConvLow * 100,
    accountConvHigh: config.accountConvHigh * 100,
    bounceHealthyMax: config.bounceHealthyMax * 100,
    bounceWarningMax: config.bounceWarningMax * 100,
    spamHealthyMax: config.spamHealthyMax * 100,
    spamWarningMax: config.spamWarningMax * 100,
  };
}
