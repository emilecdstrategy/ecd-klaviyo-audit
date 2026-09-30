import { describe, expect, it } from 'vitest';
import { computeWebInvestmentTotals, roundOneTimeTotal, roundUpTo, setupCost } from './web-audit-pricing';
import type { WebRoadmapRow } from './web-report-details';

const row = (setup_hours: number | null): WebRoadmapRow => ({
  priority: 'medium',
  item_name: 'Item',
  template_slug: null,
  note: '',
  setup_hours,
  setup_cost_label: '',
  ongoing_cost_label: '—',
});

describe('web audit prices are quoted in round numbers', () => {
  it('rounds a row up to the next $10', () => {
    expect(setupCost(row(0.5), 175)).toBe(90); // $87.50
    expect(setupCost(row(1.5), 175)).toBe(270); // $262.50
    expect(setupCost(row(2), 175)).toBe(350); // already round
    expect(setupCost(row(null), 175)).toBeNull();
  });

  it('rounds the one-time total up to the next $100', () => {
    expect(roundOneTimeTotal(3540)).toBe(3600);
    expect(roundOneTimeTotal(3500)).toBe(3500);
    expect(roundOneTimeTotal(0)).toBe(0);
  });

  it('never jumps a step on a float that is already round', () => {
    expect(roundUpTo(0.1 * 3 * 1000, 100)).toBe(300);
  });

  it('prices the Simple & Dainty report: $3,540 of rows, $3,600 total (was $3,503)', () => {
    const hours = [2, 0.5, 1, 2, 0.5, 1.5, 2.5, 3, 2, 2.5, 1, 1.5];
    const totals = computeWebInvestmentTotals(hours.map(row), 175);
    expect(totals.oneTimeTotal).toBe(3540);
    expect(roundOneTimeTotal(totals.oneTimeTotal)).toBe(3600);
  });
});
