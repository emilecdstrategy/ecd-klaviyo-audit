import type {
  CampaignsBlockKey,
  CampaignsSectionConfig,
  AttributionModelSectionConfig,
  DeliverabilitySnapshotSectionConfig,
  EmailDesignBlockKey,
  EmailDesignSectionConfig,
  ExecutiveSummaryBlockKey,
  ExecutiveSummarySectionConfig,
  FlowsBlockKey,
  FlowsSectionConfig,
  FlowsSectionConfigRoot,
  RevenueSummarySectionConfig,
  SegmentationBlockKey,
  SegmentationSectionConfig,
  SignupFormsBlockKey,
  SignupFormsSectionConfig,
} from './types';
import {
  DEFAULT_ATTRIBUTION_MODEL_SECTION,
  DEFAULT_CAMPAIGNS_SECTION,
  DEFAULT_DELIVERABILITY_SNAPSHOT_SECTION,
  DEFAULT_EMAIL_DESIGN_SECTION,
  DEFAULT_EXECUTIVE_SUMMARY_SECTION,
  DEFAULT_FLOWS_SECTION,
  DEFAULT_REVENUE_SUMMARY_SECTION,
  DEFAULT_SEGMENTATION_SECTION,
  DEFAULT_SIGNUP_FORMS_SECTION,
} from './defaults';

/**
 * Deep-merge defaults with overrides.
 *
 *   - `undefined` on the override means "use default"
 *   - `null` on the override is preserved (used to hide nullable copy)
 *   - arrays are replaced wholesale (no element-wise merging)
 *   - plain objects are recursed into
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null) return null as unknown as T;

  if (Array.isArray(patch)) {
    return patch.slice() as unknown as T;
  }

  if (
    typeof patch === 'object' &&
    patch !== null &&
    typeof base === 'object' &&
    base !== null &&
    !Array.isArray(base)
  ) {
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch as Record<string, unknown>)) {
      const nextPatch = (patch as Record<string, unknown>)[key];
      const baseValue = (base as Record<string, unknown>)[key];
      merged[key] = deepMerge(baseValue as unknown, nextPatch);
    }
    return merged as unknown as T;
  }

  return patch as T;
}

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

/**
 * Extracts a nested key from the `section_config` JSONB value.
 * Returns `undefined` when the value is missing or malformed.
 */
function extractSubtree<T>(
  sectionConfig: Record<string, unknown> | null | undefined,
  key: string,
): Partial<T> | undefined {
  if (!sectionConfig || typeof sectionConfig !== 'object') return undefined;
  const value = (sectionConfig as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Partial<T>;
}

/**
 * Generic visibility check. Works against any resolved config whose blocks all
 * extend the shared `{ hidden? }` shape.
 */
export function isBlockVisible<BlockKey extends string>(
  resolved: { hidden?: boolean; blocks?: Partial<Record<BlockKey, { hidden?: boolean } | undefined>> },
  block: BlockKey,
): boolean {
  if (resolved.hidden) return false;
  const cfg = resolved.blocks?.[block];
  if (!cfg) return true;
  return cfg.hidden !== true;
}

// -----------------------------------------------------------------------------
// Flows
// -----------------------------------------------------------------------------

/**
 * Resolves a raw `section_config.flows` override tree against the defaults
 * registry and returns a fully-populated `FlowsSectionConfig`.
 *
 * When no overrides are supplied, the returned value is the defaults object
 * verbatim, which keeps existing audits rendering identically.
 */
export function resolveFlowsConfig(
  raw: Partial<FlowsSectionConfig> | null | undefined,
  defaults: FlowsSectionConfig = DEFAULT_FLOWS_SECTION,
): FlowsSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

/**
 * Reads the Flows sub-tree out of a raw `section_config` JSONB value of the
 * row whose `section_key = 'flows'`.
 */
export function extractFlowsRawConfig(
  sectionConfig: Record<string, unknown> | null | undefined,
): Partial<FlowsSectionConfig> | undefined {
  if (!sectionConfig || typeof sectionConfig !== 'object') return undefined;
  const root = sectionConfig as FlowsSectionConfigRoot;
  return root.flows;
}

/**
 * Centralized helper so every consumer reads block visibility the same way.
 * Returns `true` when the block should render.
 */
export function isFlowsBlockVisible(resolved: FlowsSectionConfig, block: FlowsBlockKey): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Segmentation
// -----------------------------------------------------------------------------

export function extractSegmentationRawConfig(
  sectionConfig: Record<string, unknown> | null | undefined,
): Partial<SegmentationSectionConfig> | undefined {
  return extractSubtree<SegmentationSectionConfig>(sectionConfig, 'segmentation');
}

export function resolveSegmentationConfig(
  raw: Partial<SegmentationSectionConfig> | null | undefined,
  defaults: SegmentationSectionConfig = DEFAULT_SEGMENTATION_SECTION,
): SegmentationSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isSegmentationBlockVisible(
  resolved: SegmentationSectionConfig,
  block: SegmentationBlockKey,
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Signup Forms
// -----------------------------------------------------------------------------

export function extractSignupFormsRawConfig(
  sectionConfig: Record<string, unknown> | null | undefined,
): Partial<SignupFormsSectionConfig> | undefined {
  return extractSubtree<SignupFormsSectionConfig>(sectionConfig, 'signup_forms');
}

export function resolveSignupFormsConfig(
  raw: Partial<SignupFormsSectionConfig> | null | undefined,
  defaults: SignupFormsSectionConfig = DEFAULT_SIGNUP_FORMS_SECTION,
): SignupFormsSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isSignupFormsBlockVisible(
  resolved: SignupFormsSectionConfig,
  block: SignupFormsBlockKey,
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------

export function extractCampaignsRawConfig(
  sectionConfig: Record<string, unknown> | null | undefined,
): Partial<CampaignsSectionConfig> | undefined {
  return extractSubtree<CampaignsSectionConfig>(sectionConfig, 'campaigns');
}

export function resolveCampaignsConfig(
  raw: Partial<CampaignsSectionConfig> | null | undefined,
  defaults: CampaignsSectionConfig = DEFAULT_CAMPAIGNS_SECTION,
): CampaignsSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isCampaignsBlockVisible(
  resolved: CampaignsSectionConfig,
  block: CampaignsBlockKey,
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Email Design
// -----------------------------------------------------------------------------

export function extractEmailDesignRawConfig(
  sectionConfig: Record<string, unknown> | null | undefined,
): Partial<EmailDesignSectionConfig> | undefined {
  return extractSubtree<EmailDesignSectionConfig>(sectionConfig, 'email_design');
}

export function resolveEmailDesignConfig(
  raw: Partial<EmailDesignSectionConfig> | null | undefined,
  defaults: EmailDesignSectionConfig = DEFAULT_EMAIL_DESIGN_SECTION,
): EmailDesignSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isEmailDesignBlockVisible(
  resolved: EmailDesignSectionConfig,
  block: EmailDesignBlockKey,
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Deliverability Snapshot
// -----------------------------------------------------------------------------

export function extractDeliverabilitySnapshotRawConfig(
  layout: Record<string, unknown> | null | undefined,
): Partial<DeliverabilitySnapshotSectionConfig> | undefined {
  return extractSubtree<DeliverabilitySnapshotSectionConfig>(layout, 'deliverability_snapshot');
}

export function resolveDeliverabilitySnapshotConfig(
  raw: Partial<DeliverabilitySnapshotSectionConfig> | null | undefined,
  defaults: DeliverabilitySnapshotSectionConfig = DEFAULT_DELIVERABILITY_SNAPSHOT_SECTION,
): DeliverabilitySnapshotSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isDeliverabilitySnapshotBlockVisible(
  resolved: DeliverabilitySnapshotSectionConfig,
  block: 'keyFindings',
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Attribution Model
// -----------------------------------------------------------------------------

export function extractAttributionModelRawConfig(
  layout: Record<string, unknown> | null | undefined,
): Partial<AttributionModelSectionConfig> | undefined {
  return extractSubtree<AttributionModelSectionConfig>(layout, 'attribution_model');
}

export function resolveAttributionModelConfig(
  raw: Partial<AttributionModelSectionConfig> | null | undefined,
  defaults: AttributionModelSectionConfig = DEFAULT_ATTRIBUTION_MODEL_SECTION,
): AttributionModelSectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isAttributionModelBlockVisible(
  resolved: AttributionModelSectionConfig,
  block: 'keyFindings',
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Revenue Summary
// -----------------------------------------------------------------------------

export function resolveRevenueSummaryConfig(
  raw: Partial<RevenueSummarySectionConfig> | null | undefined,
  defaults: RevenueSummarySectionConfig = DEFAULT_REVENUE_SUMMARY_SECTION,
): RevenueSummarySectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

// -----------------------------------------------------------------------------
// Executive Summary
// -----------------------------------------------------------------------------

export function extractExecutiveSummaryRawConfig(
  layout: Record<string, unknown> | null | undefined,
): Partial<ExecutiveSummarySectionConfig> | undefined {
  return extractSubtree<ExecutiveSummarySectionConfig>(layout, 'executive_summary');
}

export function resolveExecutiveSummaryConfig(
  raw: Partial<ExecutiveSummarySectionConfig> | null | undefined,
  defaults: ExecutiveSummarySectionConfig = DEFAULT_EXECUTIVE_SUMMARY_SECTION,
): ExecutiveSummarySectionConfig {
  if (!raw) return defaults;
  return deepMerge(defaults, raw);
}

export function isExecutiveSummaryBlockVisible(
  resolved: ExecutiveSummarySectionConfig,
  block: ExecutiveSummaryBlockKey,
): boolean {
  return isBlockVisible(resolved, block);
}

// -----------------------------------------------------------------------------
// Revenue opportunity visibility (hidden audit sections)
// -----------------------------------------------------------------------------

export function isRevenueOpportunitySectionVisible(
  sectionKey: string,
  sectionConfig: Record<string, unknown> | null | undefined,
): boolean {
  switch (sectionKey) {
    case 'flows':
      return !resolveFlowsConfig(extractFlowsRawConfig(sectionConfig)).hidden;
    case 'segmentation':
      return !resolveSegmentationConfig(extractSegmentationRawConfig(sectionConfig)).hidden;
    case 'campaigns':
      return !resolveCampaignsConfig(extractCampaignsRawConfig(sectionConfig)).hidden;
    case 'signup_forms':
      return !resolveSignupFormsConfig(extractSignupFormsRawConfig(sectionConfig)).hidden;
    case 'email_design':
      return !resolveEmailDesignConfig(extractEmailDesignRawConfig(sectionConfig)).hidden;
    default:
      return true;
  }
}
