import { describe, expect, it } from 'vitest';
import {
  classifyRate,
  formatBenchmarkRange,
  getFlowBenchmarks,
  RECOVERY_CONV_BENCHMARK,
  STANDARD_CONV_BENCHMARK,
} from './benchmarks';

describe('benchmarks', () => {
  it('uses recovery conversion band for abandoned checkout flows', () => {
    const b = getFlowBenchmarks('Abandoned Checkout Flow');
    expect(b.tier).toBe('recovery');
    expect(b.convRateLow).toBe(RECOVERY_CONV_BENCHMARK.low);
    expect(b.convRateHigh).toBe(RECOVERY_CONV_BENCHMARK.high);
  });

  it('uses standard conversion band for welcome flows', () => {
    const b = getFlowBenchmarks('Welcome Series');
    expect(b.tier).toBe('standard');
    expect(b.convRateLow).toBe(STANDARD_CONV_BENCHMARK.low);
  });

  it('marks non-revenue flows as conv N/A', () => {
    const b = getFlowBenchmarks('Order Confirmation');
    expect(b.convApplicable).toBe(false);
    expect(formatBenchmarkRange(b.convRateLow, b.convRateHigh)).toBe('N/A');
  });

  it('classifies rates against low threshold', () => {
    expect(classifyRate(0.03, 0.02, 0.05)).toBe('good');
    expect(classifyRate(0.015, 0.02, 0.05)).toBe('warning');
    expect(classifyRate(0.01, 0.02, 0.05)).toBe('bad');
  });
});
