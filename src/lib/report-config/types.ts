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

export type BlockVisibility = Record<string, boolean>;

export type FlowRating = 'good' | 'warning' | 'bad' | 'missing';

export interface FlowsHealthBenchmarks {
  openRateLow?: number;
  openRateHigh?: number;
  clickRateLow?: number;
  clickRateHigh?: number;
  revenueTiers?: Array<{ min: number; label: string }>;
}

export interface FlowsRevenueInsights {
  /** null explicitly hides this callout; undefined falls back to default. */
  concentration?: string | null;
  /** null explicitly hides this callout; undefined falls back to default. */
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
