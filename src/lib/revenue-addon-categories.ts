import type { RevenueOpportunityTemplate } from './types';

export type AddOnTemplateCategory = 'klaviyo' | 'ecd' | 'ongoing' | 'other';

export const ADDON_CATEGORY_ORDER: AddOnTemplateCategory[] = ['klaviyo', 'ecd', 'ongoing', 'other'];

export const ADDON_CATEGORY_LABELS: Record<AddOnTemplateCategory, string> = {
  klaviyo: 'Klaviyo products',
  ecd: 'ECD implementation',
  ongoing: 'Ongoing management',
  other: 'Other',
};

export function categorizeTemplateSlug(slug: string): AddOnTemplateCategory {
  if (slug.startsWith('klaviyo_')) return 'klaviyo';
  if (slug.startsWith('ecd_')) return 'ecd';
  if (slug.startsWith('ongoing_')) return 'ongoing';
  return 'other';
}

export function groupTemplatesByCategory(
  templates: RevenueOpportunityTemplate[],
): Record<AddOnTemplateCategory, RevenueOpportunityTemplate[]> {
  const groups: Record<AddOnTemplateCategory, RevenueOpportunityTemplate[]> = {
    klaviyo: [],
    ecd: [],
    ongoing: [],
    other: [],
  };
  for (const template of templates) {
    groups[categorizeTemplateSlug(template.slug)].push(template);
  }
  return groups;
}

export function summarizeTemplatePricing(template: Pick<
  RevenueOpportunityTemplate,
  'one_time_price' | 'one_time_label' | 'monthly_price' | 'monthly_label'
>): string | null {
  const parts: string[] = [];
  if (template.one_time_price != null && template.one_time_price > 0) {
    parts.push(`$${template.one_time_price.toLocaleString()} setup`);
  } else if (template.one_time_label?.trim()) {
    parts.push(template.one_time_label.trim());
  }
  if (template.monthly_price != null && template.monthly_price > 0) {
    parts.push(`$${template.monthly_price.toLocaleString()}/mo`);
  } else if (template.monthly_label?.trim()) {
    parts.push(template.monthly_label.trim());
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
