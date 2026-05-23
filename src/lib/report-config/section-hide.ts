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

export function writeGenericBlockPatch(
  base: Record<string, unknown> | null | undefined,
  sectionKey: string,
  blockKey: string,
  blockPatch: Record<string, unknown>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const existing =
    root[sectionKey] && typeof root[sectionKey] === 'object' && !Array.isArray(root[sectionKey])
      ? (root[sectionKey] as Record<string, unknown>)
      : {};
  const prevBlocks =
    existing.blocks && typeof existing.blocks === 'object' && !Array.isArray(existing.blocks)
      ? (existing.blocks as Record<string, unknown>)
      : {};
  const prevBlock =
    prevBlocks[blockKey] && typeof prevBlocks[blockKey] === 'object' && !Array.isArray(prevBlocks[blockKey])
      ? (prevBlocks[blockKey] as Record<string, unknown>)
      : {};
  const mergedBlock = { ...prevBlock, ...blockPatch };
  const mergedBlocks = { ...prevBlocks, [blockKey]: mergedBlock };
  return { ...root, [sectionKey]: { ...existing, blocks: mergedBlocks } };
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

export function writeFlowsBlockPatch(
  base: Record<string, unknown> | null | undefined,
  blockKey: string,
  blockPatch: Record<string, unknown>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const flowsRaw =
    root.flows && typeof root.flows === 'object' && !Array.isArray(root.flows)
      ? (root.flows as Partial<FlowsSectionConfig>)
      : {};
  const prevBlocks = (flowsRaw.blocks ?? {}) as Record<string, unknown>;
  const prevBlock =
    prevBlocks[blockKey] && typeof prevBlocks[blockKey] === 'object' && !Array.isArray(prevBlocks[blockKey])
      ? (prevBlocks[blockKey] as Record<string, unknown>)
      : {};
  const mergedBlock = { ...prevBlock, ...blockPatch };
  return { ...root, flows: { ...flowsRaw, blocks: { ...prevBlocks, [blockKey]: mergedBlock } } };
}

export function writeExecutiveBlockPatch(
  layout: Record<string, unknown> | null | undefined,
  blockKey: string,
  blockPatch: Record<string, unknown>,
): Record<string, unknown> {
  const root = { ...((layout ?? {}) as Record<string, unknown>) };
  const exec = { ...((root.executive_summary as Record<string, unknown>) ?? {}) };
  const blocks = { ...((exec.blocks as Record<string, unknown>) ?? {}) };
  const prevBlock =
    blocks[blockKey] && typeof blocks[blockKey] === 'object' && !Array.isArray(blocks[blockKey])
      ? (blocks[blockKey] as Record<string, unknown>)
      : {};
  blocks[blockKey] = { ...prevBlock, ...blockPatch };
  exec.blocks = blocks;
  root.executive_summary = exec;
  return root;
}

export function writeRevenueBlockPatch(
  layout: Record<string, unknown> | null | undefined,
  blockKey: string,
  blockPatch: Record<string, unknown>,
): Record<string, unknown> {
  const root = { ...((layout ?? {}) as Record<string, unknown>) };
  const rs = { ...((root.revenue_summary as Record<string, unknown>) ?? {}) };
  const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
  const prevBlock =
    blocks[blockKey] && typeof blocks[blockKey] === 'object' && !Array.isArray(blocks[blockKey])
      ? (blocks[blockKey] as Record<string, unknown>)
      : {};
  blocks[blockKey] = { ...prevBlock, ...blockPatch };
  rs.blocks = blocks;
  root.revenue_summary = rs;
  return root;
}
