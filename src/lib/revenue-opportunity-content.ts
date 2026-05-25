import type { RevenueOpportunityAddOnItem, RevenueOpportunityTemplate } from './types';

type ContentSource = Pick<RevenueOpportunityAddOnItem, 'content' | 'bullets'>
  | Pick<RevenueOpportunityTemplate, 'content' | 'bullets'>;

/** Markdown body for a revenue opportunity — prefers `content`, falls back to legacy `bullets` array. */
export function resolveRevenueOpportunityContent(item: ContentSource): string {
  if (item.content?.trim()) return item.content.trim();
  const bullets = (item.bullets ?? []).map(v => String(v).trim()).filter(Boolean);
  if (!bullets.length) return '';
  return bullets.map(bullet => `- ${bullet}`).join('\n');
}
