import type { FlowsBlockKey, FlowsSectionConfig, FlowsSectionConfigRoot } from './types';
import { DEFAULT_FLOWS_SECTION } from './defaults';

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
  if (resolved.hidden) return false;
  const cfg = resolved.blocks?.[block];
  if (!cfg) return true;
  return cfg.hidden !== true;
}
