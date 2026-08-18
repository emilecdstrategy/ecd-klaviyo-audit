import { getAddOnItemsFromLayout } from './addon-highlight';
import { listAuditSections, listRevenueOpportunityTemplates } from './db';
import { parseWebRoadmapDetail, type WebRoadmapRow } from './web-report-details';
import { investmentRows, parseMonthly, setupCost } from './web-audit-pricing';
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
  ProposalLineItem,
  ProposalTemplate,
  ProposalTemplateLineItem,
  RevenueOpportunityAddOnItem,
} from './types';

/**
 * Snapshot the audit's included, priced add-on items as proposal line items.
 * Presenter/demo-only fields (highlighted, related sections, notes) are dropped.
 */
export function auditAddOnsToLineItems(
  layout: unknown,
  /** template_slug -> Xero revenue bucket, from the line item catalog. */
  serviceKeyBySlug: Map<string, string | null> = new Map(),
): Omit<CreateProposalLineItemInput, 'proposal_id'>[] {
  const items = getAddOnItemsFromLayout(layout)
    .filter(item => isAddOnInvestmentIncluded(item) && addOnHasPricing(item))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  return items.map((item: RevenueOpportunityAddOnItem, index) => ({
    template_slug: item.template_slug || null,
    // Coded from the catalog so the Xero draft invoice works without anyone
    // re-picking the account on every line.
    xero_service_key: serviceKeyBySlug.get(item.template_slug ?? '') ?? null,
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

/**
 * Snapshot a web audit's ticked roadmap rows as proposal line items. Setup is
 * priced from hours at the rate the roadmap was built with, so a proposal always
 * quotes what the client already read in the report rather than re-deriving it
 * from today's platform rate. An ongoing cost only becomes a monthly price when
 * it is an actual figure; free text stays a label so nobody invents a retainer.
 */
export function webRoadmapToLineItems(
  sectionDetails: unknown,
  serviceKeyBySlug: Map<string, string | null> = new Map(),
): Omit<CreateProposalLineItemInput, 'proposal_id'>[] {
  const detail = parseWebRoadmapDetail(sectionDetails);
  const rate = detail.hourly_rate ?? 0;

  return investmentRows(detail.rows).map((row: WebRoadmapRow, index) => {
    const oneTime = rate > 0 ? setupCost(row, rate) : null;
    const monthly = parseMonthly(row.ongoing_cost_label);
    const ongoingLabel = (row.ongoing_cost_label ?? '').trim();
    return {
      template_slug: row.template_slug || null,
      xero_service_key: serviceKeyBySlug.get(row.template_slug ?? '') ?? null,
      name: row.item_name,
      description: row.note ?? '',
      content: '',
      one_time_price: oneTime,
      // No hours estimated yet: carry whatever the roadmap showed instead of
      // quoting zero.
      one_time_label: oneTime == null ? (row.setup_cost_label?.trim() || null) : null,
      monthly_price: monthly,
      monthly_label: monthly == null && ongoingLabel && !/^[—-]$/.test(ongoingLabel) ? ongoingLabel : null,
      image_url: null,
      display_order: (index + 1) * 10,
    };
  });
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
    title: `Proposal for ${client.company_name}`,
    content_blocks: template?.content_blocks?.map(b => ({ ...b })) ?? [],
    include_contracts: template?.default_contracts ? [...template.default_contracts] : [],
    recipient_name: client.name ?? '',
    recipient_email: '',
  });

  // Best effort: if the catalog cannot be read, lines are simply uncoded and the
  // per-line picker is still there. Never block creating the proposal for it.
  const serviceKeyBySlug = new Map<string, string | null>();
  try {
    for (const t of await listRevenueOpportunityTemplates()) {
      if (t.xero_service_key) serviceKeyBySlug.set(t.slug, t.xero_service_key);
    }
  } catch { /* leave lines uncoded */ }

  // A web audit prices its work on the roadmap, not on revenue-opportunity
  // add-ons, so reading audit.layout there produced an empty proposal.
  const base = audit.audit_type === 'web'
    ? webRoadmapToLineItems(
        (await listAuditSections(audit.id)).find(s => s.section_key === 'web_revenue_summary')?.section_details,
        serviceKeyBySlug,
      )
    : auditAddOnsToLineItems(audit.layout, serviceKeyBySlug);

  const lineItems = base.map(item => ({ ...item, proposal_id: proposal.id }));
  if (lineItems.length > 0) await createProposalLineItems(lineItems);

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
    title: `Proposal for ${client.company_name}`,
    content_blocks: template?.content_blocks?.map(b => ({ ...b })) ?? [],
    include_contracts: template?.default_contracts ? [...template.default_contracts] : [],
    recipient_name: client.name ?? '',
    recipient_email: '',
    discount_type: template?.discount_type ?? 'none',
    discount_value: template?.discount_value ?? 0,
    discount_applies_to: template?.discount_applies_to ?? 'one_time',
    discount_label: template?.discount_label ?? null,
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

/** Strip a live proposal line item down to the template-embedded shape. */
function lineItemToTemplateItem(item: ProposalLineItem, index: number): ProposalTemplateLineItem {
  return {
    template_slug: item.template_slug,
    name: item.name,
    description: item.description,
    content: item.content,
    one_time_price: item.one_time_price,
    one_time_label: item.one_time_label,
    monthly_price: item.monthly_price,
    monthly_label: item.monthly_label,
    image_url: item.image_url,
    display_order: (index + 1) * 10,
  };
}

/**
 * Build a template payload from an existing proposal, carrying everything except
 * client-specific info (recipient, client, tokens, status, signatures). Cover is
 * dropped too, since it is driven by global settings rather than per-template.
 */
export function buildTemplateInputFromProposal(
  name: string,
  proposal: Proposal,
  lineItems: ProposalLineItem[],
  displayOrder: number,
): Omit<ProposalTemplate, 'id' | 'created_at' | 'updated_at'> {
  const sorted = [...lineItems].sort((a, b) => a.display_order - b.display_order);
  return {
    name: name.trim(),
    content_blocks: proposal.content_blocks.map(b => ({ ...b })),
    default_line_items: sorted.map(lineItemToTemplateItem),
    default_contracts: [...proposal.include_contracts],
    discount_type: proposal.discount_type,
    discount_value: proposal.discount_value,
    discount_applies_to: proposal.discount_applies_to,
    discount_label: proposal.discount_label,
    is_active: true,
    display_order: displayOrder,
  };
}
