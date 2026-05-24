/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { computeAuditTotalRevenueOpportunity } from './revenue-calculator';

describe('computeAuditTotalRevenueOpportunity', () => {
  it('excludes revenue from hidden audit sections', () => {
    const sections = [
      {
        section_key: 'flows',
        revenue_opportunity: 5000,
        section_config: { flows: { hidden: false } },
      },
      {
        section_key: 'email_design',
        revenue_opportunity: 800,
        section_config: { email_design: { hidden: true } },
      },
      {
        section_key: 'campaigns',
        revenue_opportunity: 1200,
        section_config: { campaigns: { hidden: false } },
      },
    ];

    const total = computeAuditTotalRevenueOpportunity(sections, {});
    expect(total).toBe(6200);
  });

  it('still includes visible add-on items from layout', () => {
    const sections = [
      {
        section_key: 'flows',
        revenue_opportunity: 1000,
        section_config: { flows: { hidden: false } },
      },
    ];
    const layout = {
      revenue_summary: {
        blocks: {
          addOns: {
            items: [
              { revenue_monthly: 250, is_hidden: false },
              { revenue_monthly: 100, is_hidden: true },
            ],
          },
        },
      },
    };

    expect(computeAuditTotalRevenueOpportunity(sections, layout)).toBe(1250);
  });
});
