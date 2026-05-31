/**
 * Report configuration types.
 *
 * `section_config` on `audit_sections` is a flexible JSONB column. Each section
 * stores its own key-scoped subtree (e.g. `{ flows: FlowsSectionConfig }`) so
 * one column can absorb future section shapes without schema migrations.
 *
 * Convention on override semantics:
 *   - `undefined`  -> use the default
 *   - `null`       -> hide that specific piece of copy (for nullable insights)
 *   - any value    -> replace the default
 */
import type { RevenueOpportunityAddOnItem } from '../types';

export type BlockVisibility = Record<string, boolean>;

export type FlowRating = 'good' | 'warning' | 'bad' | 'missing';

// -----------------------------------------------------------------------------
// Flows (existing, keeps specialized shape for benchmarks + insights)
// -----------------------------------------------------------------------------

export interface FlowsHealthBenchmarks {
  openRateLow?: number;
  openRateHigh?: number;
  clickRateLow?: number;
  clickRateHigh?: number;
  revenueTiers?: Array<{ min: number; label: string }>;
}

export interface FlowsRevenueInsights {
  /** @deprecated No longer rendered — kept for legacy config compatibility */
  concentration?: string | null;
  /** @deprecated No longer rendered — kept for legacy config compatibility */
  volume?: string | null;
}

export interface FlowsRubricOverrides {
  coreFlowsMatrix?: unknown;
  segmentationSnapshot?: unknown;
}

export interface FlowsSectionConfig {
  hidden?: boolean;
  sectionNumber?: string;
  sectionTitle?: string;
  sectionSubtitle?: string;
  blocks: {
    narrative?: {
      hidden?: boolean;
      currentTitle?: string;
      optimizedTitle?: string;
    };
    healthScore?: {
      hidden?: boolean;
      title?: string;
      subtitle?: string;
      benchmarks?: FlowsHealthBenchmarks;
    };
    revenueBreakdown?: {
      hidden?: boolean;
      title?: string;
      insights?: FlowsRevenueInsights;
    };
    flowTable?: {
      hidden?: boolean;
      title?: string;
      subtitleOverride?: string;
      defaultVisibleRows?: number;
    };
    inventoryTable?: {
      hidden?: boolean;
      title?: string;
    };
    rubric?: {
      hidden?: boolean;
      title?: string;
      overrides?: FlowsRubricOverrides;
    };
  };
}

export type FlowsBlockKey = keyof NonNullable<FlowsSectionConfig['blocks']>;

/**
 * Root shape of the `section_config` JSONB column for the Flows section row.
 * Stored on the row whose `section_key = 'flows'`.
 */
export interface FlowsSectionConfigRoot {
  flows?: Partial<FlowsSectionConfig>;
}

// -----------------------------------------------------------------------------
// Generic section config (used by the other 6 sections)
// -----------------------------------------------------------------------------

/**
 * Shared block shape. Per-section types can extend this with extra fields.
 *
 *   - `hidden`:   toggles the block on/off
 *   - `title`:    override the block heading
 *   - `subtitle`: override the block sub-heading / lead paragraph
 */
export interface GenericBlockConfig {
  hidden?: boolean;
  title?: string;
  subtitle?: string;
}

export interface NarrativeBlockConfig extends GenericBlockConfig {
  currentTitle?: string;
  optimizedTitle?: string;
}

export interface BaseSectionConfig {
  hidden?: boolean;
  sectionNumber?: string;
  sectionTitle?: string;
  sectionSubtitle?: string;
}

// ----- Account Health --------------------------------------------------------

export interface AccountHealthSectionConfig extends BaseSectionConfig {
  blocks: {
    healthScoreTable?: GenericBlockConfig;
  };
}

export type AccountHealthBlockKey = keyof NonNullable<AccountHealthSectionConfig['blocks']>;

// ----- Segmentation ----------------------------------------------------------

export interface SegmentationSectionConfig extends BaseSectionConfig {
  blocks: {
    narrative?: NarrativeBlockConfig;
    rubric?: GenericBlockConfig;
    segmentTable?: GenericBlockConfig;
  };
}

export type SegmentationBlockKey = keyof NonNullable<SegmentationSectionConfig['blocks']>;

// ----- Signup Forms ----------------------------------------------------------

export interface SignupFormsSectionConfig extends BaseSectionConfig {
  blocks: {
    narrative?: NarrativeBlockConfig;
    rubric?: GenericBlockConfig;
    formTable?: GenericBlockConfig;
  };
}

export type SignupFormsBlockKey = keyof NonNullable<SignupFormsSectionConfig['blocks']>;

// ----- Campaigns -------------------------------------------------------------

export interface CampaignsSectionConfig extends BaseSectionConfig {
  blocks: {
    narrative?: NarrativeBlockConfig;
    rubric?: GenericBlockConfig;
    campaignTable?: GenericBlockConfig;
  };
}

export type CampaignsBlockKey = keyof NonNullable<CampaignsSectionConfig['blocks']>;

// ----- Email Design ----------------------------------------------------------

export interface EmailDesignSectionConfig extends BaseSectionConfig {
  blocks: {
    comparison?: GenericBlockConfig;
  };
}

export type EmailDesignBlockKey = keyof NonNullable<EmailDesignSectionConfig['blocks']>;

// ----- Revenue Summary (Opportunity) -----------------------------------------

export interface RevenueSummarySectionConfig extends BaseSectionConfig {
  blocks: {
    metrics?: GenericBlockConfig;
    totalBanner?: GenericBlockConfig & { disclaimer?: string | null };
    addOns?: GenericBlockConfig & { items?: RevenueOpportunityAddOnItem[] };
    timeline?: GenericBlockConfig;
  };
}

export type RevenueSummaryBlockKey = keyof NonNullable<RevenueSummarySectionConfig['blocks']>;

// ----- Deliverability Snapshot -----------------------------------------------

export interface DeliverabilitySnapshotSectionConfig extends BaseSectionConfig {
  blocks?: Record<string, never>;
}

// ----- Executive Summary (section 01, hero) ---------------------------------

export interface ExecutiveSummarySectionConfig extends BaseSectionConfig {
  blocks: {
    hero?: GenericBlockConfig & {
      /** Override the headline; when omitted the auto-generated "X could unlock $Y" line is used. */
      headline?: string | null;
      /** Override the intro paragraph; when null the paragraph is hidden. */
      intro?: string | null;
      /** Override the leading eyebrow tag ("Klaviyo Email Audit — X"). Null hides it. */
      eyebrow?: string | null;
    };
    accountSnapshot?: GenericBlockConfig;
    strengths?: GenericBlockConfig;
    findings?: GenericBlockConfig;
  };
}

export type ExecutiveSummaryBlockKey = keyof NonNullable<ExecutiveSummarySectionConfig['blocks']>;

// -----------------------------------------------------------------------------
// Root shapes per section row
// -----------------------------------------------------------------------------

export interface AccountHealthSectionConfigRoot {
  account_health?: Partial<AccountHealthSectionConfig>;
}

export interface SegmentationSectionConfigRoot {
  segmentation?: Partial<SegmentationSectionConfig>;
}

export interface SignupFormsSectionConfigRoot {
  signup_forms?: Partial<SignupFormsSectionConfig>;
}

export interface CampaignsSectionConfigRoot {
  campaigns?: Partial<CampaignsSectionConfig>;
}

export interface EmailDesignSectionConfigRoot {
  email_design?: Partial<EmailDesignSectionConfig>;
}

export interface RevenueSummarySectionConfigRoot {
  revenue_summary?: Partial<RevenueSummarySectionConfig>;
}

export interface DeliverabilitySnapshotSectionConfigRoot {
  deliverability_snapshot?: Partial<DeliverabilitySnapshotSectionConfig>;
}

// -----------------------------------------------------------------------------
// Section key union
// -----------------------------------------------------------------------------

export type SectionKey =
  | 'account_health'
  | 'flows'
  | 'deliverability_snapshot'
  | 'segmentation'
  | 'signup_forms'
  | 'campaigns'
  | 'email_design'
  | 'revenue_summary';
