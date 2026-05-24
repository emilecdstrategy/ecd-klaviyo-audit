export type EntityType = 'flow' | 'campaign' | 'segment' | 'form';

export const ENTITY_TYPES: EntityType[] = ['flow', 'campaign', 'segment', 'form'];

export const ENTITY_LABELS: Record<EntityType, string> = {
  flow: 'Flow',
  campaign: 'Campaign',
  segment: 'Segment',
  form: 'Form',
};

export const ENTITY_CHIP_CLASS: Record<EntityType, string> = {
  flow: 'entity-tag',
  campaign: 'entity-tag',
  segment: 'entity-tag',
  form: 'entity-tag',
};

const ENTITY_MD_REGEX = /`(flow|campaign|segment|form):([^`]+)`/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getEntityMarkerRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /`(flow|campaign|segment|form):([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function overlapsEntityMarkerRange(
  start: number,
  length: number,
  ranges: Array<[number, number]>,
): boolean {
  const end = start + length;
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
}

/** Repair nested or broken entity markers left by legacy auto-tagging. */
export function repairEntityMarkers(text: string): string {
  let result = String(text ?? '');

  // Legacy nested wrap: `flow:`flow:ECD | Welcome Series` NEW` -> `flow:ECD | Welcome Series NEW`
  result = result.replace(
    /`flow:`flow:([^`]+)`([^`]*?)`/g,
    (_match, name: string, suffix: string) => `\`flow:${name}${suffix}\``,
  );

  // Simple nested prefix: `flow:`flow:Name` -> `flow:Name`
  result = result.replace(/`flow:`flow:/gi, '`flow:');

  // Orphan prefix immediately before a valid marker: `flow:` `flow:Name` -> `flow:Name`
  result = result.replace(/`flow:\s*`(flow|campaign|segment|form):/gi, '`$1:');

  return result;
}

export function resolveEntityType(name: string, lookup: Map<string, EntityType>): EntityType {
  const trimmed = name.trim();
  if (!trimmed) return 'flow';
  if (lookup.has(trimmed)) return lookup.get(trimmed)!;
  for (const [key, type] of lookup) {
    if (key.toLowerCase() === trimmed.toLowerCase()) return type;
  }
  return 'flow';
}

export function entityMd(type: EntityType, name: string): string {
  return `\`${type}:${name.trim()}\``;
}

export function buildEntityLookup(sources: {
  flows?: { name?: string | null }[];
  flowPerformance?: { flow_name?: string | null }[];
  segments?: { name?: string | null }[];
  campaigns?: { name?: string | null }[];
  forms?: { name?: string | null }[];
}): Map<string, EntityType> {
  const map = new Map<string, EntityType>();
  const add = (name: string | null | undefined, type: EntityType) => {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (!map.has(trimmed)) map.set(trimmed, type);
  };

  for (const f of sources.flows ?? []) add(f.name, 'flow');
  for (const f of sources.flowPerformance ?? []) add(f.flow_name, 'flow');
  for (const s of sources.segments ?? []) add(s.name, 'segment');
  for (const c of sources.campaigns ?? []) add(c.name, 'campaign');
  for (const f of sources.forms ?? []) add(f.name, 'form');

  return map;
}

/** Convert legacy **bold** entity names into typed entity tags for rendering. */
export function migrateBoldEntitiesToTags(text: string, lookup: Map<string, EntityType>): string {
  if (!lookup.size) return text;
  return text.replace(/\*\*(.+?)\*\*/g, (match, rawName: string) => {
    const name = rawName.trim();
    const type = lookup.get(name);
    if (!type) return match;
    return entityMd(type, name);
  });
}

/** Auto-wrap known Klaviyo entity names that are not already tagged or bolded. */
export function autoTagEntityNames(text: string, lookup: Map<string, EntityType>): string {
  if (!lookup.size) return text;

  let result = text;
  const markerRanges = getEntityMarkerRanges(result);
  const names = Array.from(lookup.keys()).sort((a, b) => b.length - a.length);

  for (const name of names) {
    const type = lookup.get(name);
    if (!type) continue;
    const regex = new RegExp(`(?<!\\*\\*)\\b(${escapeRegex(name)})\\b(?!\\*\\*)`, 'gi');
    result = result.replace(regex, (match, _captured, offset) => {
      if (typeof offset !== 'number') return match;
      if (overlapsEntityMarkerRange(offset, match.length, markerRanges)) return match;
      const tagged = entityMd(type, match);
      if (result.includes(tagged)) return match;
      return tagged;
    });
    // Recompute ranges after each pass so new tags are protected.
    markerRanges.splice(0, markerRanges.length, ...getEntityMarkerRanges(result));
  }

  return result;
}

export function prepareAuditText(
  text: string,
  lookup: Map<string, EntityType>,
  autoTag = true,
): string {
  let result = repairEntityMarkers(text || '');
  result = migrateBoldEntitiesToTags(result, lookup);
  if (autoTag) result = autoTagEntityNames(result, lookup);
  return repairEntityMarkers(result);
}

export function stripEntityMarkers(text: string): string {
  return text.replace(ENTITY_MD_REGEX, '$2');
}
