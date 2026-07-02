import { getAddOnItemsFromLayout } from './addon-highlight';
import { addOnHasPricing } from './addon-pricing';
import { isAddOnInvestmentIncluded } from './investment-summary';
import { resolveRevenueOpportunityContent } from './revenue-opportunity-content';
import {
  createProposal,
  createProposalLineItems,
  listProposalTemplates,
  type CreateProposalLineItemInput,
} from './proposals-db';
import type {
  Audit,
  Client,
  Proposal,
  ProposalTemplate,
  RevenueOpportunityAddOnItem,
} from './types';

/**
 * Snapshot the audit's included, priced add-on items as proposal line items.
 * Presenter/demo-only fields (highlighted, related sections, notes) are dropped.
 */
export function auditAddOnsToLineItems(
  layout: unknown,
): Omit<CreateProposalLineItemInput, 'proposal_id'>[] {
  const items = getAddOnItemsFromLayout(layout)
    .filter(item => isAddOnInvestmentIncluded(item) && addOnHasPricing(item))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  return items.map((item: RevenueOpportunityAddOnItem, index) => ({
    template_slug: item.template_slug || null,
    name: item.name,
    description: item.description ?? '',
    content: resolveRevenueOpportunityContent(item),
    one_time_price: item.one_time_price != null ? Number(item.one_time_price) : null,
    one_time_label: item.one_time_label?.trim() || null,
    monthly_price: item.monthly_price != null ? Number(item.monthly_price) : null,
    monthly_label: item.monthly_label?.trim() || null,
    image_url: item.image_url ?? null,
    display_order: (index + 1) * 10,
  }));
}

async function resolveDefaultTemplate(): Promise<ProposalTemplate | null> {
  try {
    const templates = await listProposalTemplates({ activeOnly: true });
    return templates[0] ?? null;
  } catch {
    return null;
  }
}

/** Create a draft proposal prefilled from an audit's revenue opportunity add-ons. */
export async function createProposalFromAudit(audit: Audit, client: Client): Promise<Proposal> {
  const template = await resolveDefaultTemplate();
  const proposal = await createProposal({
    client_id: client.id,
    audit_id: audit.id,
    template_id: template?.id ?? null,
    title: `Proposal — ${client.company_name}`,
    content_blocks: template?.content_blocks?.map(b => ({ ...b })) ?? [],
    include_contracts: template?.default_contracts ? [...template.default_contracts] : [],
    recipient_name: client.name ?? '',
    recipient_email: '',
  });

  const lineItems = auditAddOnsToLineItems(audit.layout).map(item => ({
    ...item,
    proposal_id: proposal.id,
  }));
  await createProposalLineItems(lineItems);

  return proposal;
}

/** Create a draft proposal from scratch, optionally seeded from a template. */
export async function createProposalFromTemplate(
  client: Client,
  template: ProposalTemplate | null,
): Promise<Proposal> {
  const proposal = await createProposal({
    client_id: client.id,
    template_id: template?.id ?? null,
    title: `Proposal — ${client.company_name}`,
    content_blocks: template?.content_blocks?.map(b => ({ ...b })) ?? [],
    include_contracts: template?.default_contracts ? [...template.default_contracts] : [],
    recipient_name: client.name ?? '',
    recipient_email: '',
  });

  const defaults = template?.default_line_items ?? [];
  if (defaults.length > 0) {
    await createProposalLineItems(
      defaults.map((item, index) => ({
        ...item,
        display_order: (index + 1) * 10,
        proposal_id: proposal.id,
      })),
    );
  }

  return proposal;
}
