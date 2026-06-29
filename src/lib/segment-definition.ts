import type { KlaviyoSegmentSnapshot } from './types';

export type GroupNameEntry = { name: string; kind: 'segment' | 'list' };

export type GroupNameMap = Record<string, GroupNameEntry>;

export type SegmentDefinitionSignals = {
  excludesApplePrivacyOpens: boolean;
  includesApplePrivacyOpens: boolean;
  excludesBotClicks: boolean;
  includesBotClicks: boolean;
  usesEmailOpens: boolean;
  usesEmailClicks: boolean;
  usesPlacedOrder: boolean;
  usesActiveOnSite: boolean;
};

export type ParsedSegmentDefinition = {
  available: boolean;
  criteriaLines: string[];
  signals: SegmentDefinitionSignals;
  groupLogic: 'and' | 'or' | 'mixed';
};

const EMPTY_SIGNALS: SegmentDefinitionSignals = {
  excludesApplePrivacyOpens: false,
  includesApplePrivacyOpens: false,
  excludesBotClicks: false,
  includesBotClicks: false,
  usesEmailOpens: false,
  usesEmailClicks: false,
  usesPlacedOrder: false,
  usesActiveOnSite: false,
};

function normalizePropertyKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

function isApplePrivacyProperty(property: string): boolean {
  const key = normalizePropertyKey(property);
  return key.includes('appleprivacy') || key.includes('mpp');
}

function isBotClickProperty(property: string): boolean {
  return normalizePropertyKey(property) === 'botclick';
}

function metricLabel(metricId: string, metricNames?: Record<string, string>): string {
  const name = metricNames?.[metricId];
  return name && name.trim() ? name : `Metric ${metricId}`;
}

function formatTimeframeFilter(filter: unknown): string | null {
  if (!filter || typeof filter !== 'object') return null;
  const tf = filter as Record<string, unknown>;
  const type = String(tf.type ?? '');
  if (type === 'alltime') return 'over all time';
  if (type === 'date' && tf.operator === 'after' && typeof tf.value === 'string') {
    return `after ${new Date(tf.value).toLocaleDateString()}`;
  }
  if (type === 'date' && tf.operator === 'before' && typeof tf.value === 'string') {
    return `before ${new Date(tf.value).toLocaleDateString()}`;
  }
  if (type === 'date-range' && typeof tf.start === 'string' && typeof tf.end === 'string') {
    return `${new Date(tf.start).toLocaleDateString()} – ${new Date(tf.end).toLocaleDateString()}`;
  }
  const unit = String(tf.unit ?? tf.quantity ?? '');
  const quantity = tf.quantity ?? tf.value;
  if (type.includes('relative') || tf.operator === 'in-the-last') {
    if (quantity != null && unit) return `in the last ${quantity} ${String(unit).replace(/s$/, '')}${Number(quantity) === 1 ? '' : 's'}`;
  }
  if (typeof tf.operator === 'string' && typeof tf.value === 'string') {
    return `${tf.operator.replace(/-/g, ' ')} ${tf.value}`;
  }
  return null;
}

function formatMeasurementFilter(filter: unknown): string | null {
  if (!filter || typeof filter !== 'object') return null;
  const mf = filter as Record<string, unknown>;
  const operator = String(mf.operator ?? '').replace(/-/g, ' ');
  const value = mf.value;
  if (operator && value != null) return `${operator} ${value}`;
  return null;
}

function formatMetricFilter(property: string, filter: unknown): string | null {
  if (!filter || typeof filter !== 'object') return null;
  const f = filter as Record<string, unknown>;
  const operator = String(f.operator ?? '').replace(/-/g, ' ');
  const value = f.value;
  if (operator === 'equals' || operator === 'is') {
    if (typeof value === 'boolean') return `${property} = ${value ? 'Yes' : 'No'}`;
    if (value != null) return `${property} = ${value}`;
  }
  if (operator && value != null) return `${property} ${operator} ${value}`;
  return `${property} filter applied`;
}

function applyMetricFilterSignals(property: string, filter: unknown, signals: SegmentDefinitionSignals) {
  if (!filter || typeof filter !== 'object') return;
  const f = filter as Record<string, unknown>;
  const value = f.value;
  if (isApplePrivacyProperty(property)) {
    if (value === false || value === 'false') signals.excludesApplePrivacyOpens = true;
    if (value === true || value === 'true') signals.includesApplePrivacyOpens = true;
  }
  if (isBotClickProperty(property)) {
    if (value === false || value === 'false') signals.excludesBotClicks = true;
    if (value === true || value === 'true') signals.includesBotClicks = true;
  }
}

function noteMetricUsage(metricName: string, signals: SegmentDefinitionSignals) {
  const key = metricName.toLowerCase();
  if (key.includes('opened email') || key.includes('open email')) signals.usesEmailOpens = true;
  if (key.includes('clicked email') || key.includes('click email')) signals.usesEmailClicks = true;
  if (key.includes('placed order') || key.includes('ordered product')) signals.usesPlacedOrder = true;
  if (key.includes('active on site') || key.includes('viewed product')) signals.usesActiveOnSite = true;
}

function formatGroupMembership(
  groupIds: unknown,
  isMember: unknown,
  groupNames?: GroupNameMap,
): string {
  const ids = Array.isArray(groupIds) ? groupIds.map(String).filter(Boolean) : [];
  const memberPrefix =
    isMember === true ? 'Is in' : isMember === false ? 'Is not in' : 'Membership in';
  if (ids.length === 0) return `${memberPrefix} list/segment`;

  const labels = ids.map(id => {
    const entry = groupNames?.[id];
    if (entry?.name) {
      const kindLabel = entry.kind === 'list' ? 'list' : 'segment';
      return `${kindLabel} “${entry.name}”`;
    }
    return 'unknown audience (not in snapshot)';
  });
  return `${memberPrefix} ${labels.join(', ')}`;
}

function parseCondition(
  condition: unknown,
  metricNames: Record<string, string> | undefined,
  signals: SegmentDefinitionSignals,
  groupNames?: GroupNameMap,
): string | null {
  if (!condition || typeof condition !== 'object') return null;
  const c = condition as Record<string, unknown>;
  const type = String(c.type ?? '');

  if (type === 'profile-metric') {
    const metricId = String(c.metric_id ?? '');
    const label = metricLabel(metricId, metricNames);
    noteMetricUsage(label, signals);
    const measurement = String(c.measurement ?? 'count');
    const measurementFilter = formatMeasurementFilter(c.measurement_filter);
    const timeframe = formatTimeframeFilter(c.timeframe_filter);
    const filters = Array.isArray(c.metric_filters) ? c.metric_filters : [];
    for (const mf of filters) {
      if (mf && typeof mf === 'object') {
        const property = String((mf as Record<string, unknown>).property ?? 'Property');
        applyMetricFilterSignals(property, (mf as Record<string, unknown>).filter, signals);
      }
    }
    const filterBits = filters
      .map(mf => {
        if (!mf || typeof mf !== 'object') return null;
        const property = String((mf as Record<string, unknown>).property ?? 'Property');
        return formatMetricFilter(property, (mf as Record<string, unknown>).filter);
      })
      .filter(Boolean);
    const parts = [
      `${label} ${measurement}${measurementFilter ? ` ${measurementFilter}` : ''}`,
      timeframe,
      ...filterBits,
    ].filter(Boolean);
    return parts.join(' · ');
  }

  if (type === 'profile-attribute') {
    const field = String(c.field ?? 'Profile attribute');
    const filter = formatMetricFilter(field, c.filter);
    return filter ? `Profile: ${filter}` : `Profile attribute: ${field}`;
  }

  if (type === 'profile-property') {
    const property = String(c.property ?? 'Property');
    const filter = formatMetricFilter(property, c.filter);
    return filter ? `${property} ${filter}` : `Profile property: ${property}`;
  }

  if (type === 'profile-group-membership') {
    return formatGroupMembership(c.group_ids, c.is_member, groupNames);
  }

  if (type === 'profile-marketing-consent') {
    const channel = String(c.consent ?? c.channel ?? 'marketing');
    return `Marketing consent: ${channel}`;
  }

  return `${type.replace(/-/g, ' ')} condition`;
}

function extractDefinition(raw: unknown): unknown | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const attrs = obj.attributes as Record<string, unknown> | undefined;
  if (attrs?.definition) return attrs.definition;
  if (obj.definition) return obj.definition;
  return null;
}

function extractMetricNames(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const map = (raw as Record<string, unknown>)._ecd_metric_names;
  if (map && typeof map === 'object') return map as Record<string, string>;
  return undefined;
}

function extractGroupNames(raw: unknown): GroupNameMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const map = (raw as Record<string, unknown>)._ecd_group_names;
  if (map && typeof map === 'object') return map as GroupNameMap;
  return undefined;
}

export function mergeGroupNameMaps(...maps: (GroupNameMap | undefined)[]): GroupNameMap {
  const out: GroupNameMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [id, entry] of Object.entries(map)) {
      if (entry?.name) out[id] = entry;
    }
  }
  return out;
}

export function parseSegmentDefinition(
  segment: Pick<KlaviyoSegmentSnapshot, 'raw'>,
  metricNames?: Record<string, string>,
  groupNames?: GroupNameMap,
): ParsedSegmentDefinition {
  const definition = extractDefinition(segment.raw);
  const resolvedMetricNames = metricNames ?? extractMetricNames(segment.raw);
  const resolvedGroupNames = groupNames ?? extractGroupNames(segment.raw);
  if (!definition || typeof definition !== 'object') {
    return {
      available: false,
      criteriaLines: [],
      signals: { ...EMPTY_SIGNALS },
      groupLogic: 'and',
    };
  }

  const signals: SegmentDefinitionSignals = { ...EMPTY_SIGNALS };
  const groups = Array.isArray((definition as Record<string, unknown>).condition_groups)
    ? (definition as Record<string, unknown>).condition_groups as unknown[]
    : [];

  const criteriaLines: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (!group || typeof group !== 'object') continue;
    const conditions = Array.isArray((group as Record<string, unknown>).conditions)
      ? (group as Record<string, unknown>).conditions as unknown[]
      : [];
    for (let ci = 0; ci < conditions.length; ci++) {
      const line = parseCondition(conditions[ci], resolvedMetricNames, signals, resolvedGroupNames);
      if (line) {
        criteriaLines.push(groups.length > 1 ? `Group ${gi + 1}: ${line}` : line);
      }
    }
  }

  return {
    available: criteriaLines.length > 0,
    criteriaLines,
    signals,
    groupLogic: groups.length > 1 ? 'or' : 'and',
  };
}

export function segmentPriorityScore(name: string): number {
  const key = name.toLowerCase();
  if (/engaged|active subscriber|30.?day|60.?day|90.?day/.test(key)) return 0;
  if (/unengaged|inactive|sunset|non.?engaged/.test(key)) return 1;
  if (/vip|ltv|high.?value|best customer/.test(key)) return 2;
  if (/apple|privacy|mpp/.test(key)) return 3;
  return 10;
}

export function buildSegmentSignalTags(signals: SegmentDefinitionSignals): string[] {
  const tags: string[] = [];
  if (signals.excludesApplePrivacyOpens) tags.push('Excludes Apple Privacy opens');
  if (signals.includesApplePrivacyOpens) tags.push('Includes Apple Privacy opens');
  if (signals.excludesBotClicks) tags.push('Excludes bot clicks');
  if (signals.includesBotClicks) tags.push('Includes bot clicks');
  if (signals.usesEmailClicks && !signals.usesEmailOpens) tags.push('Click-based engagement');
  if (signals.usesEmailOpens) tags.push('Uses email opens');
  if (signals.usesPlacedOrder) tags.push('Uses placed order');
  if (signals.usesActiveOnSite) tags.push('Uses site activity');
  return tags;
}
