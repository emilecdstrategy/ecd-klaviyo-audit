import type {
  AccountHealthSectionConfig,
  CampaignsSectionConfig,
  DeliverabilitySnapshotSectionConfig,
  EmailDesignSectionConfig,
  ExecutiveSummarySectionConfig,
  FlowsSectionConfig,
  RevenueSummarySectionConfig,
  SegmentationSectionConfig,
  SignupFormsSectionConfig,
} from './types';

/**
 * Defaults registry for the Flows section.
 *
 * These mirror the hardcoded constants in the report sub-components so the
 * resolver can supply the same values PublicReport used to render before any
 * overrides were introduced. When a field is omitted, the consuming component
 * still owns its own internal default (e.g. a sub-component's "Assessment"
 * column header), so this registry intentionally covers only overridable copy.
 */

import { DEFAULT_FLOWS_HEALTH_BENCHMARKS } from '../benchmarks';

export { DEFAULT_FLOWS_HEALTH_BENCHMARKS };

export const DEFAULT_FLOWS_VISIBLE_ROWS = 2;

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

// -----------------------------------------------------------------------------
// Account Health (section 02)
// -----------------------------------------------------------------------------

export const DEFAULT_ACCOUNT_HEALTH_SECTION: AccountHealthSectionConfig = {
  hidden: true,
  sectionNumber: '02',
  sectionTitle: 'Account Health Score',
  sectionSubtitle: undefined,
  blocks: {
    healthScoreTable: {
      hidden: false,
      title: undefined,
      subtitle: undefined,
    },
  },
};

// -----------------------------------------------------------------------------
// Deliverability Snapshot (section 04)
// -----------------------------------------------------------------------------

export const DEFAULT_DELIVERABILITY_SNAPSHOT_SECTION: DeliverabilitySnapshotSectionConfig = {
  hidden: false,
  sectionNumber: '04',
  sectionTitle: 'Deliverability',
  sectionSubtitle: undefined,
};

// -----------------------------------------------------------------------------
// Segmentation (section 05)
// -----------------------------------------------------------------------------

export const DEFAULT_SEGMENTATION_SECTION: SegmentationSectionConfig = {
  hidden: false,
  sectionNumber: '04',
  sectionTitle: 'Segments',
  sectionSubtitle: undefined,
  blocks: {
    narrative: {
      hidden: false,
      currentTitle: 'Current State',
      optimizedTitle: 'Optimized State',
    },
    rubric: {
      hidden: false,
      title: undefined,
    },
    segmentTable: {
      hidden: false,
      title: 'Segment inventory',
      subtitle: 'Reference list from Klaviyo — open if you need the full breakdown.',
    },
  },
};

// -----------------------------------------------------------------------------
// Signup Forms (section 05)
// -----------------------------------------------------------------------------

export const DEFAULT_SIGNUP_FORMS_SECTION: SignupFormsSectionConfig = {
  hidden: false,
  sectionNumber: '05',
  sectionTitle: 'Signup Forms',
  sectionSubtitle: undefined,
  blocks: {
    narrative: {
      hidden: false,
      currentTitle: 'Current State',
      optimizedTitle: 'Optimized State',
    },
    rubric: {
      hidden: false,
      title: undefined,
    },
    formTable: {
      hidden: false,
      title: 'Signup form inventory',
      subtitle: 'Reference list from Klaviyo — open if you need the full breakdown.',
    },
  },
};

// -----------------------------------------------------------------------------
// Campaigns (section 06)
// -----------------------------------------------------------------------------

export const DEFAULT_CAMPAIGNS_SECTION: CampaignsSectionConfig = {
  hidden: false,
  sectionNumber: '06',
  sectionTitle: 'Campaigns',
  sectionSubtitle: undefined,
  blocks: {
    narrative: {
      hidden: false,
      currentTitle: 'Current State',
      optimizedTitle: 'Optimized State',
    },
    rubric: {
      hidden: false,
      title: undefined,
    },
    campaignTable: {
      hidden: false,
      title: 'Campaign inventory',
      subtitle: 'Reference list from Klaviyo — open if you need the full breakdown.',
    },
  },
};

// -----------------------------------------------------------------------------
// Email Design (section 07)
// -----------------------------------------------------------------------------

export const DEFAULT_EMAIL_DESIGN_SECTION: EmailDesignSectionConfig = {
  hidden: false,
  sectionNumber: '07',
  sectionTitle: 'Email Design',
  sectionSubtitle: undefined,
  blocks: {
    comparison: {
      hidden: false,
      title: undefined,
      subtitle: 'Side-by-side comparison of a recent campaign email and an ECD-designed benchmark for your industry.',
    },
  },
};

// -----------------------------------------------------------------------------
// Revenue Summary / Opportunity (section 08)
// -----------------------------------------------------------------------------

export const DEFAULT_REVENUE_SUMMARY_DISCLAIMER =
  'Revenue estimates use industry benchmarks and your account metrics. Actual results depend on execution, seasonality, offers, ' +
  'and list health. Figures represent opportunity, not guaranteed outcomes.';

export const DEFAULT_REVENUE_SUMMARY_SECTION: RevenueSummarySectionConfig = {
  hidden: false,
  sectionNumber: '08',
  sectionTitle: 'Revenue Opportunity',
  sectionSubtitle: undefined,
  blocks: {
    metrics: {
      hidden: false,
      title: undefined,
    },
    totalBanner: {
      hidden: false,
      title: 'Total identified opportunity',
      subtitle: 'Additional email-attributed revenue identified in this audit',
      disclaimer: DEFAULT_REVENUE_SUMMARY_DISCLAIMER,
    },
    addOns: {
      hidden: false,
      title: 'Recommended Klaviyo Add-Ons',
      subtitle: 'Optional platform opportunities selected for this audit.',
      items: [],
    },
    timeline: {
      hidden: false,
      title: 'Implementation Timeline',
      subtitle: 'Suggested rollout order — work through each phase before moving to the next.',
    },
  },
};

// -----------------------------------------------------------------------------
// Executive Summary / Hero (section 01)
// -----------------------------------------------------------------------------

export const DEFAULT_EXECUTIVE_SUMMARY_SECTION: ExecutiveSummarySectionConfig = {
  hidden: false,
  sectionNumber: '01',
  sectionTitle: 'Executive Summary',
  sectionSubtitle: undefined,
  blocks: {
    hero: {
      hidden: true,
      headline: undefined,
      intro: undefined,
      eyebrow: undefined,
    },
    accountSnapshot: {
      hidden: false,
      title: 'Account Snapshot',
      subtitle: undefined,
    },
    strengths: {
      hidden: false,
      title: "What's Working",
      subtitle: undefined,
    },
    findings: {
      hidden: false,
      title: 'Key Findings',
      subtitle: undefined,
    },
  },
};

/** Display order for executive summary blocks (Account Snapshot → What's Working → Key Findings). */
export const EXECUTIVE_SUMMARY_BLOCK_ORDER = ['accountSnapshot', 'strengths', 'findings'] as const;
