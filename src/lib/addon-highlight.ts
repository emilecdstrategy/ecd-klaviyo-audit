import type { RevenueOpportunityAddOnItem } from './types';

export type SectionDemoMarker = {
  template_slug: string;
  name: string;
  presenter_note?: string;
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

export function buildSectionDemoMap(items: RevenueOpportunityAddOnItem[]): Map<string, SectionDemoMarker[]> {
  const map = new Map<string, SectionDemoMarker[]>();
  for (const item of items) {
    if (!item.highlighted || item.is_hidden) continue;
    const keys = Array.isArray(item.related_section_keys) ? item.related_section_keys : [];
    for (const key of keys) {
      const slug = String(key).trim();
      if (!slug) continue;
      const list = map.get(slug) ?? [];
      list.push({
        template_slug: item.template_slug,
        name: item.name,
        presenter_note: item.presenter_note,
      });
      map.set(slug, list);
    }
  }
  return map;
}
