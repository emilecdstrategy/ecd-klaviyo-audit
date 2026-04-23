import type { FlowsSectionConfig } from './types';

/**
 * Defaults registry for the Flows section.
 *
 * These mirror the hardcoded constants in the report sub-components so the
 * resolver can supply the same values PublicReport used to render before any
 * overrides were introduced. When a field is omitted, the consuming component
 * still owns its own internal default (e.g. a sub-component's "Assessment"
 * column header), so this registry intentionally covers only overridable copy.
 */

export const DEFAULT_FLOWS_VISIBLE_ROWS = 5;

export const DEFAULT_FLOWS_HEALTH_BENCHMARKS = {
  openRateLow: 0.30,
  openRateHigh: 0.45,
  clickRateLow: 0.05,
  clickRateHigh: 0.10,
  revenueTiers: [
    { min: 500_000, label: 'Strong' },
    { min: 300_000, label: 'Good' },
    { min: 200_000, label: 'Moderate' },
    { min: 100_000, label: 'Needs work' },
    { min: 50_000, label: 'Starter' },
  ],
} as const;

export const DEFAULT_FLOWS_REVENUE_INSIGHT_CONCENTRATION =
  'If either of your top two flows breaks, more than half your automation revenue disappears. ' +
  'Diversify into post-purchase, cross-sell, and winback flows.';

export const DEFAULT_FLOWS_REVENUE_INSIGHT_VOLUME =
  'These high-volume, low-conversion flows need rebuilding or sunsetting.';

export const DEFAULT_FLOWS_SECTION: FlowsSectionConfig = {
  hidden: false,
  sectionNumber: '03',
  sectionTitle: 'Flows',
  sectionSubtitle: undefined,
  blocks: {
    narrative: {
      hidden: false,
      currentTitle: 'Current State',
      optimizedTitle: 'Optimized State',
    },
    healthScore: {
      hidden: false,
      title: 'Overall Flow Health Score',
      subtitle: undefined,
      benchmarks: {
        openRateLow: DEFAULT_FLOWS_HEALTH_BENCHMARKS.openRateLow,
        openRateHigh: DEFAULT_FLOWS_HEALTH_BENCHMARKS.openRateHigh,
        clickRateLow: DEFAULT_FLOWS_HEALTH_BENCHMARKS.clickRateLow,
        clickRateHigh: DEFAULT_FLOWS_HEALTH_BENCHMARKS.clickRateHigh,
        revenueTiers: [...DEFAULT_FLOWS_HEALTH_BENCHMARKS.revenueTiers],
      },
    },
    revenueBreakdown: {
      hidden: false,
      title: 'Revenue Breakdown by Flow',
      insights: {
        concentration: DEFAULT_FLOWS_REVENUE_INSIGHT_CONCENTRATION,
        volume: DEFAULT_FLOWS_REVENUE_INSIGHT_VOLUME,
      },
    },
    flowTable: {
      hidden: false,
      title: 'Flow Performance Details',
      subtitleOverride: undefined,
      defaultVisibleRows: DEFAULT_FLOWS_VISIBLE_ROWS,
    },
    inventoryTable: {
      hidden: false,
      title: 'Full Flow Inventory',
    },
    rubric: {
      hidden: false,
      title: 'Core Flows Matrix',
    },
  },
};
