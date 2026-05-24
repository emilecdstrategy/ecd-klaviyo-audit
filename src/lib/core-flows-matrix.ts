export type CoreFlowRow = {
  flow_name?: string;
  present?: boolean;
  live?: boolean;
  email_count?: number | null;
  current_structure_note?: string;
  recommended_structure?: string;
};

type CoreFlowDefinition = {
  name: string;
  patterns: RegExp[];
};

const CORE_FLOW_TAIL: CoreFlowDefinition[] = [
  {
    name: 'Winback / Re-engagement',
    patterns: [/winback|win[\s-]?back|re[\s-]?engage|re-engage|lapsed|non[\s-]?engaged/i],
  },
  {
    name: 'Back-in-Stock',
    patterns: [/back[\s-]?in[\s-]?stock|restock|in stock/i],
  },
  {
    name: 'Sunset / List Cleaning',
    patterns: [/sunset|list clean|list[\s-]?clean/i],
  },
];

const CORE_FLOW_HEAD: CoreFlowDefinition[] = [
  {
    name: 'Abandoned Cart',
    patterns: [/abandon.*cart|cart.*abandon|checkout.*abandon|abandon.*checkout|abandoned checkout/i],
  },
  {
    name: 'Browse Abandonment',
    patterns: [/browse|viewed collection/i],
  },
  {
    name: 'Welcome Series',
    patterns: [/welcome|new subscriber|onboard/i],
  },
  {
    name: 'Post-Purchase',
    patterns: [/post[\s-]?purchase|post[\s-]?buy|thank you|order confirm|replenish|upsell|cross[\s-]?sell/i],
  },
];

const SUBSCRIPTION_FLOW: CoreFlowDefinition = {
  name: 'Subscription Lifecycle',
  patterns: [/subscription|subscr|recharge|skio|loop|renewal|rebill|membership|next order/i],
};

export const CORE_FLOW_MATRIX_NAMES = [
  ...CORE_FLOW_HEAD.map(item => item.name),
  ...CORE_FLOW_TAIL.map(item => item.name),
] as const;

export const CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION = [
  ...CORE_FLOW_HEAD.map(item => item.name),
  SUBSCRIPTION_FLOW.name,
  ...CORE_FLOW_TAIL.map(item => item.name),
] as const;

/** @deprecated Prefer CORE_FLOW_MATRIX_NAMES — kept for older imports. */
export const FLOW_TYPES = [...CORE_FLOW_MATRIX_NAMES];

function getDefinitions(includeSubscription: boolean): CoreFlowDefinition[] {
  if (includeSubscription) {
    return [...CORE_FLOW_HEAD, SUBSCRIPTION_FLOW, ...CORE_FLOW_TAIL];
  }
  return [...CORE_FLOW_HEAD, ...CORE_FLOW_TAIL];
}

export function getCoreFlowMatrixNames(includeSubscription = false): readonly string[] {
  return includeSubscription
    ? CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION
    : CORE_FLOW_MATRIX_NAMES;
}

function stripFlowTags(value: string): string {
  return value
    .replace(/`flow:/gi, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text structure notes: strip entity markers and repair broken auto-tag nesting. */
export function sanitizeStructureNote(text: string): string {
  let result = String(text ?? '').trim();
  if (!result) return '';

  // Repair nested tags created when auto-tag matched inside an existing marker.
  result = result.replace(/`flow:`flow:/gi, '`flow:');

  // Well-formed entity markers → display name only.
  result = result.replace(/`(flow|campaign|segment|form):([^`]+)`/gi, '$2');

  // Orphan markers left after partial parsing.
  result = result.replace(/`flow:([^`,]+)`/gi, '$1');
  result = result.replace(/`/g, '');
  result = result.replace(/^flow:\s*/i, '');

  return result.replace(/\s+/g, ' ').trim();
}

export function classifyCoreFlowName(raw: string, includeSubscription = true): string | null {
  const cleaned = stripFlowTags(String(raw ?? ''));
  if (!cleaned) return null;

  for (const def of getDefinitions(includeSubscription)) {
    if (def.name.toLowerCase() === cleaned.toLowerCase()) return def.name;
  }

  for (const def of getDefinitions(includeSubscription)) {
    if (def.patterns.some(pattern => pattern.test(cleaned))) return def.name;
  }

  return null;
}

function shouldIncludeSubscription(
  rows: CoreFlowRow[],
  includeSubscription?: boolean,
): boolean {
  if (typeof includeSubscription === 'boolean') return includeSubscription;
  if (rows.some(row => classifyCoreFlowName(String(row.flow_name ?? ''), true) === SUBSCRIPTION_FLOW.name)) {
    return true;
  }
  return rows.length >= CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION.length;
}

function emptyRow(name: string): CoreFlowRow {
  return {
    flow_name: name,
    present: false,
    live: false,
    email_count: null,
    current_structure_note: '',
    recommended_structure: '',
  };
}

/** Normalize AI or legacy rows to canonical predefined matrix labels. */
export function normalizeCoreFlowsMatrix(
  rows: CoreFlowRow[] | null | undefined,
  options?: { includeSubscription?: boolean },
): CoreFlowRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const includeSubscription = shouldIncludeSubscription(rows, options?.includeSubscription);
  const template = getCoreFlowMatrixNames(includeSubscription);
  const mapped = new Map<string, CoreFlowRow>();

  for (const row of rows) {
    const canonical = classifyCoreFlowName(String(row.flow_name ?? ''), includeSubscription);
    if (!canonical || mapped.has(canonical)) continue;
    mapped.set(canonical, {
      ...row,
      flow_name: canonical,
      current_structure_note: sanitizeStructureNote(String(row.current_structure_note ?? '')),
      recommended_structure: sanitizeStructureNote(String(row.recommended_structure ?? '')),
    });
  }

  if (mapped.size === 0 && rows.length === template.length) {
    return template.map((name, index) => ({
      ...rows[index],
      flow_name: name,
      current_structure_note: sanitizeStructureNote(String(rows[index]?.current_structure_note ?? '')),
      recommended_structure: sanitizeStructureNote(String(rows[index]?.recommended_structure ?? '')),
    }));
  }

  return template.map(name => {
    const row = mapped.get(name);
    if (!row) return emptyRow(name);
    return row;
  });
}

export function normalizeFlowsSectionDetails(
  sectionDetails: unknown,
  options?: { includeSubscription?: boolean },
): Record<string, unknown> | null {
  if (!sectionDetails || typeof sectionDetails !== 'object' || Array.isArray(sectionDetails)) {
    return sectionDetails as Record<string, unknown> | null;
  }

  const details = { ...(sectionDetails as Record<string, unknown>) };
  const flows = details.flows;
  if (!flows || typeof flows !== 'object' || Array.isArray(flows)) return details;

  const flowsObj = { ...(flows as Record<string, unknown>) };
  const coreFlows = flowsObj.core_flows;
  if (!Array.isArray(coreFlows)) return details;

  flowsObj.core_flows = normalizeCoreFlowsMatrix(coreFlows as CoreFlowRow[], options);
  details.flows = flowsObj;
  return details;
}

export function normalizeFlowsSectionPatch(
  patch: { section_details?: unknown },
  options?: { includeSubscription?: boolean },
): { section_details?: unknown } {
  if (!patch.section_details) return patch;
  return {
    ...patch,
    section_details: normalizeFlowsSectionDetails(patch.section_details, options),
  };
}
