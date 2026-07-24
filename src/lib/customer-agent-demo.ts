import { websiteHostname } from './site-favicon';

/** Add-on templates that include the live Customer Agent demo CTA. */
export const CUSTOMER_AGENT_DEMO_SLUGS = new Set([
  'klaviyo_customer_agent',
  'klaviyo_customer_hub',
]);

const DEMO_BASE_URL = 'https://customeragent.ecdigitalstrategy.com';

export function customerAgentDemoUrl(domain: string): string {
  const normalized = domain.trim().replace(/^www\./, '');
  return `${DEMO_BASE_URL}/${encodeURIComponent(normalized)}`;
}

export function resolveCustomerAgentDemoUrl(websiteUrl?: string | null): string | null {
  const domain = websiteHostname(websiteUrl);
  if (!domain) return null;
  return customerAgentDemoUrl(domain);
}

export function addOnHasCustomerAgentDemo(templateSlug: string): boolean {
  return CUSTOMER_AGENT_DEMO_SLUGS.has(templateSlug);
}

/** Match a Customer Hub / Customer Agent line item by name, for cases where the
 * template_slug was not stored (e.g. items added before slugs, or hand-typed). */
export function nameHasCustomerAgentDemo(name?: string | null): boolean {
  return /customer\s*(hub|agent)/i.test((name ?? '').trim());
}

/** Demo URL for a line item: personalized to the client's storefront when we know
 * it, otherwise the generic demo so the "View demo" CTA always works. */
export function customerAgentDemoUrlOrDefault(websiteUrl?: string | null): string {
  return resolveCustomerAgentDemoUrl(websiteUrl) ?? DEMO_BASE_URL;
}
