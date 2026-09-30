import { describe, expect, it } from 'vitest';
import { computeWebInvestmentTotals, roundUpTo, setupCost } from './web-audit-pricing';
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

  it('never jumps a step on a float that is already round', () => {
    expect(roundUpTo(0.1 * 3 * 1000, 100)).toBe(300);
  });

  it('totals the Simple & Dainty report to exactly what its rows add up to: $3,540 (was $3,503)', () => {
    const hours = [2, 0.5, 1, 2, 0.5, 1.5, 2.5, 3, 2, 2.5, 1, 1.5];
    const rows = hours.map(row);
    const totals = computeWebInvestmentTotals(rows, 175);
    const rowSum = rows.reduce((sum, r) => sum + (setupCost(r, 175) ?? 0), 0);
    expect(totals.oneTimeTotal).toBe(3540);
    expect(totals.oneTimeTotal).toBe(rowSum);
  });
});
