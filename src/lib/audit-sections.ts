import type { AuditType } from './types';

/** Section rows seeded when a Klaviyo audit is created. */
export const KLAVIYO_AUDIT_SECTION_KEYS = [
  'account_health',
  'flows',
  'segmentation',
  'campaigns',
  'email_design',
  'signup_forms',
  'revenue_summary',
] as const;

/**
 * Section rows seeded when a Web audit is created. Deliberately namespaced
 * with `web_` so Klaviyo-specific report/AI code never matches them.
 */
export const WEB_AUDIT_SECTION_KEYS = [
  'web_overview',
  'web_homepage',
  'web_product_page',
  'web_collection_page',
  'web_cart',
  'web_performance',
  'web_revenue_summary',
] as const;

export const WEB_SECTION_TITLES: Record<string, string> = {
  web_overview: 'Overview',
  web_homepage: 'Homepage',
  web_product_page: 'Product Page',
  web_collection_page: 'Collection Page',
  web_cart: 'Cart',
  web_performance: 'Performance',
  web_revenue_summary: 'Revenue Opportunities',
};

export function sectionKeysForAuditType(auditType: AuditType): readonly string[] {
  return auditType === 'web' ? WEB_AUDIT_SECTION_KEYS : KLAVIYO_AUDIT_SECTION_KEYS;
}
