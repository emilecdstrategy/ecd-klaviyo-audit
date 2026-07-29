import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadConnection, xeroApi } from "./xero.ts";

/**
 * Creates the DRAFT sales invoice for a signed proposal.
 *
 * DRAFT is deliberate: Xero never emails a draft, so nothing reaches the client
 * until someone approves and sends it from Xero.
 *
 * Only ONE-TIME fees are invoiced. Monthly retainers are recurring billing and
 * belong in a Xero repeating invoice; billing 12 months up front here would be
 * wrong, so any monthly items are noted on the invoice instead.
 */

type LineItem = {
  name: string;
  description: string | null;
  one_time_price: number | string | null;
  monthly_price: number | string | null;
  display_order: number | null;
};

type ProposalRow = {
  id: string;
  proposal_number: number | null;
  title: string;
  recipient_name: string | null;
  recipient_email: string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  discount_applies_to: string | null;
  discount_label: string | null;
  client?: { company_name?: string | null; email?: string | null } | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Proportional share of a one-time discount for a single line, so the invoice
 * total matches the proposal total exactly even after rounding. */
function discountedLines(proposal: ProposalRow, items: LineItem[]) {
  const oneTime = items
    .filter((i) => num(i.one_time_price) !== null)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  const subtotal = oneTime.reduce((s, i) => s + (num(i.one_time_price) ?? 0), 0);

  const appliesTo = proposal.discount_applies_to ?? "one_time";
  const applies = appliesTo === "one_time" || appliesTo === "both";
  const type = proposal.discount_type ?? "none";
  const value = num(proposal.discount_value) ?? 0;
  let discount = 0;
  if (applies && value > 0) {
    if (type === "percent") discount = subtotal * (Math.min(value, 100) / 100);
    else if (type === "amount") discount = Math.min(value, subtotal);
  }
  return { oneTime, subtotal, discount };
}

export async function createDraftInvoiceForProposal(
  sb: SupabaseClient,
  proposalId: string,
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string }> {
  const { data: proposalRow } = await sb
    .from("proposals")
    .select(
      "id, proposal_number, title, recipient_name, recipient_email, discount_type, discount_value, discount_applies_to, discount_label, xero_invoice_id, client:clients(company_name, email)",
    )
    .eq("id", proposalId)
    .maybeSingle();
  const proposal = proposalRow as (ProposalRow & { xero_invoice_id?: string | null }) | null;
  if (!proposal) return { ok: false, error: "proposal_not_found" };
  // Already invoiced: never post twice, however this was triggered.
  if (proposal.xero_invoice_id) return { ok: false, error: "already_invoiced" };

  const { data: itemRows } = await sb
    .from("proposal_line_items")
    .select("name, description, one_time_price, monthly_price, display_order")
    .eq("proposal_id", proposalId);
  const items = (itemRows ?? []) as LineItem[];

  const { oneTime, subtotal, discount } = discountedLines(proposal, items);
  if (oneTime.length === 0 || subtotal <= 0) {
    return { ok: false, error: "no_one_time_fees" };
  }
  if (discount >= subtotal) {
    // A 100% discount would post a zero invoice, which is never intended.
    return { ok: false, error: "fully_discounted" };
  }

  const conn = await loadConnection(sb);
  const accountCode = conn?.sales_account_code || undefined;
  const taxType = conn?.tax_type || undefined;

  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const lineItems = oneTime.map((i) => {
    const gross = num(i.one_time_price) ?? 0;
    return {
      Description: [i.name, i.description?.trim()].filter(Boolean).join(" - ").slice(0, 4000),
      Quantity: 1,
      // Xero recomputes totals from UnitAmount, so the discount is folded into
      // the unit price proportionally rather than sent as a separate field.
      UnitAmount: Math.round(gross * ratio * 100) / 100,
      ...(accountCode ? { AccountCode: accountCode } : {}),
      ...(taxType ? { TaxType: taxType } : {}),
    };
  });

  const monthly = items.filter((i) => (num(i.monthly_price) ?? 0) > 0);
  const reference = proposal.proposal_number ? `ECD-${String(proposal.proposal_number).padStart(4, "0")}` : proposal.title;
  const notes = [
    `Created automatically from signed proposal ${reference}.`,
    discount > 0
      ? `A ${proposal.discount_label || "discount"} of ${discount.toFixed(2)} was applied proportionally across the lines.`
      : "",
    monthly.length > 0
      ? `NOT INVOICED HERE: ${monthly.map((m) => `${m.name} (${num(m.monthly_price)}/mo)`).join("; ")}. Set these up as a Xero repeating invoice.`
      : "",
  ].filter(Boolean).join(" ");

  const contactName = proposal.client?.company_name?.trim() || proposal.recipient_name?.trim() || "Client";
  const contactEmail = proposal.recipient_email?.trim() || proposal.client?.email?.trim() || undefined;

  try {
    // Xero upserts a contact by Name on invoice create, so no separate lookup is
    // needed; passing the email keeps a new contact usable straight away.
    const payload = {
      Invoices: [
        {
          Type: "ACCREC",
          Status: "DRAFT",
          Contact: { Name: contactName, ...(contactEmail ? { EmailAddress: contactEmail } : {}) },
          Date: new Date().toISOString().slice(0, 10),
          Reference: reference,
          LineAmountTypes: "Exclusive",
          LineItems: lineItems,
        },
      ],
    };
    const out = await xeroApi<{ Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string }> }>(
      sb,
      "/Invoices",
      // The proposal id as the idempotency key: a retried invocation cannot
      // create a second invoice even if our own guard is bypassed.
      { method: "POST", body: payload, idempotencyKey: `proposal-${proposalId}` },
    );
    const created = out.Invoices?.[0];
    if (!created?.InvoiceID) return { ok: false, error: "xero_no_invoice_returned" };

    // Notes go on as a history note: the invoice body has no free-text field
    // that survives, and this keeps the retainer reminder attached in Xero.
    if (notes) {
      await xeroApi(sb, `/Invoices/${created.InvoiceID}/History`, {
        method: "PUT",
        body: { HistoryRecords: [{ Details: notes.slice(0, 1000) }] },
      }).catch(() => {});
    }

    await sb
      .from("proposals")
      .update({
        xero_invoice_id: created.InvoiceID,
        xero_invoice_number: created.InvoiceNumber ?? null,
        xero_invoiced_at: new Date().toISOString(),
        xero_invoice_error: null,
      })
      .eq("id", proposalId);

    return { ok: true, invoiceId: created.InvoiceID, invoiceNumber: created.InvoiceNumber ?? "" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await sb.from("proposals").update({ xero_invoice_error: error.slice(0, 400) }).eq("id", proposalId);
    return { ok: false, error };
  }
}
