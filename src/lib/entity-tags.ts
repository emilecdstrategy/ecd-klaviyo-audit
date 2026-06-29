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

const AUTO_TAG_BLOCKLIST = new Set([
  'test', 'new', 'draft', 'sent', 'live', 'manual', 'clone', 'copy', 'email', 'sms', 'pop', 'vip',
  'sale', 'promo', 'flow', 'list', 'form', 'cart', 'shop', 'buy', 'win', 'day', 'week',
]);

/** Short or generic Klaviyo asset names are too ambiguous for runtime auto-tagging in prose. */
function isAutoTagCandidate(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (AUTO_TAG_BLOCKLIST.has(trimmed.toLowerCase())) return false;
  if (/[|–—/]/.test(trimmed)) return true;
  if (/\s/.test(trimmed) && trimmed.length >= 8) return true;
  if (trimmed.length >= 12) return true;
  return trimmed.length >= 8;
}

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

const ENTITY_MARKER_BODY_REGEX = /`(flow|campaign|segment|form):([\s\S]*?)`/g;

function isInsideEntityMarkerBody(prefix: string): boolean {
  const lastTick = prefix.lastIndexOf('`');
  if (lastTick < 0) return false;
  return /^(flow|campaign|segment|form):[^`]*$/.test(prefix.slice(lastTick + 1));
}

/** Join marker bodies broken across lines (often by repairFlattenedMarkdown on "Name - Date"). */
function normalizeEntityMarkerBodies(text: string): string {
  return text.replace(ENTITY_MARKER_BODY_REGEX, (_match, type: EntityType, body: string) => {
    if (!/[\n\r]/.test(body)) return _match;
    const joined = body
      .replace(/\r\n/g, '\n')
      .replace(/\n-\s+/g, ' - ')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return `\`${type}:${joined}\``;
  });
}

/** Repair nested or broken entity markers left by legacy auto-tagging. */
export function repairEntityMarkers(text: string): string {
  let result = String(text ?? '');

  result = normalizeEntityMarkerBodies(result);

  // Legacy nested wrap: `flow:`flow:ECD | Welcome Series` NEW` -> `flow:ECD | Welcome Series NEW`
  result = result.replace(
    /`flow:`flow:([^`]+)`([^`]*?)`/g,
    (_match, name: string, suffix: string) => `\`flow:${name}${suffix}\``,
  );

  // Simple nested prefix: `flow:`flow:Name` -> `flow:Name`
  result = result.replace(/`flow:`flow:/gi, '`flow:');

  // Orphan prefix immediately before a valid marker: `flow:` `flow:Name` -> `flow:Name`
  result = result.replace(/`flow:\s*`(flow|campaign|segment|form):/gi, '`$1:');

  // Stray orphan backtick immediately before a valid marker: ` `campaign:Name` -> `campaign:Name`
  result = result.replace(/`\s+`(flow|campaign|segment|form):/gi, '`$1:');

  return normalizeEntityMarkerBodies(result);
}

export function isInsideEntityMarkerAt(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  const tickCount = (prefix.match(/`/g) ?? []).length;
  if (tickCount % 2 === 1) return true;
  return isInsideEntityMarkerBody(prefix);
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
    if (!type || !isAutoTagCandidate(name)) continue;
    const regex = new RegExp(`(?<!\\*\\*)\\b(${escapeRegex(name)})\\b(?!\\*\\*)`, 'g');
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

const ENTITY_MD_REGEX = /`(flow|campaign|segment|form):([^`]+)`/g;

export function stripEntityMarkers(text: string): string {
  return text.replace(ENTITY_MD_REGEX, '$2');
}
