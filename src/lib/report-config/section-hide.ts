import type { FlowsSectionConfig } from './types';

export function writeGenericConfigPatch(
  base: Record<string, unknown> | null | undefined,
  sectionKey: string,
  patch: { hidden?: boolean; sectionTitle?: string; sectionNumber?: string },
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const existing =
    root[sectionKey] && typeof root[sectionKey] === 'object' && !Array.isArray(root[sectionKey])
      ? (root[sectionKey] as Record<string, unknown>)
      : {};
  const merged = { ...existing, ...patch };
  return { ...root, [sectionKey]: merged };
}

export function writeFlowsConfigPatch(
  base: Record<string, unknown> | null | undefined,
  patch: Partial<FlowsSectionConfig>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const flowsRaw =
    root.flows && typeof root.flows === 'object' && !Array.isArray(root.flows)
      ? (root.flows as Partial<FlowsSectionConfig>)
      : {};
  const mergedBlocks = {
    ...(flowsRaw.blocks ?? {}),
    ...(patch.blocks ?? {}),
  };
  const merged: Partial<FlowsSectionConfig> = {
    ...flowsRaw,
    ...patch,
    ...(patch.blocks !== undefined ? { blocks: mergedBlocks } : {}),
  };
  return { ...root, flows: merged };
}
