import type { RevenueOpportunityAddOnItem } from './types';

export type SectionDemoMarker = {
  template_slug: string;
  name: string;
  presenter_note?: string;
  /** Set when building markers from layout items (section editor). */
  itemKey?: string;
};

const AUDIT_SECTION_KEY_TO_NAV_ID: Record<string, string> = {
  account_health: 'deliverability',
  flows: 'flows',
  segmentation: 'segments',
  campaigns: 'campaigns',
  email_design: 'email_design',
  signup_forms: 'forms',
};

export function auditSectionKeyToNavId(sectionKey: string): string {
  return AUDIT_SECTION_KEY_TO_NAV_ID[sectionKey] ?? sectionKey;
}

export function buildNavSectionDemoMap(items: RevenueOpportunityAddOnItem[]): Map<string, SectionDemoMarker[]> {
  const byAuditKey = buildSectionDemoMap(items);
  const navMap = new Map<string, SectionDemoMarker[]>();
  for (const [auditKey, markers] of byAuditKey.entries()) {
    const navId = auditSectionKeyToNavId(auditKey);
    const existing = navMap.get(navId) ?? [];
    navMap.set(navId, [...existing, ...markers]);
  }
  return navMap;
}

export function getAddOnItemsFromLayout(layout: unknown): RevenueOpportunityAddOnItem[] {
  const layoutObj = (layout as Record<string, unknown> | null | undefined) ?? {};
  const revenueSummary = layoutObj.revenue_summary as Record<string, unknown> | undefined;
  const blocks = revenueSummary?.blocks as Record<string, unknown> | undefined;
  const addOns = blocks?.addOns as Record<string, unknown> | undefined;
  const raw = addOns?.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object');
}

export function getHighlightedAddOns(items: RevenueOpportunityAddOnItem[]): RevenueOpportunityAddOnItem[] {
  return items.filter(item => Boolean(item.highlighted) && !item.is_hidden);
}

export const AUDIT_SECTION_OPTIONS = [
  { key: 'account_health', label: 'Account health' },
  { key: 'flows', label: 'Flows' },
  { key: 'segmentation', label: 'Segmentation' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'email_design', label: 'Email design' },
  { key: 'signup_forms', label: 'Signup forms' },
] as const;

export type AuditSectionKey = (typeof AUDIT_SECTION_OPTIONS)[number]['key'];

export function addOnItemKey(item: Pick<RevenueOpportunityAddOnItem, 'template_slug' | 'display_order'>): string {
  return `${item.template_slug}-${item.display_order ?? 0}`;
}

export function isAddOnOnSection(item: RevenueOpportunityAddOnItem, sectionKey: AuditSectionKey): boolean {
  return (item.related_section_keys ?? []).includes(sectionKey);
}

export function buildSectionDemoMap(items: RevenueOpportunityAddOnItem[]): Map<string, SectionDemoMarker[]> {
  const map = new Map<string, SectionDemoMarker[]>();
  for (const item of items) {
    if (!item.highlighted || item.is_hidden) continue;
    const keys = Array.isArray(item.related_section_keys) ? item.related_section_keys : [];
    for (const key of keys) {
      const sectionKey = String(key).trim();
      if (!sectionKey) continue;
      const list = map.get(sectionKey) ?? [];
      if (list.some(marker => marker.template_slug === item.template_slug)) continue;
      list.push({
        template_slug: item.template_slug,
        name: item.name,
        presenter_note: item.presenter_note,
        itemKey: addOnItemKey(item),
      });
      map.set(sectionKey, list);
    }
  }
  return map;
}
