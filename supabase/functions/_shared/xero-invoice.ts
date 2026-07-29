import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadConnection, xeroApi } from "./xero.ts";
import {
  type AccountDefaults,
  describeUnmapped,
  type Resolved,
  resolveAccountCode,
  type RevenueAccountRow,
} from "./xero-accounts.ts";

/**
 * Creates the DRAFT sales invoice for a signed proposal.
 *
 * DRAFT is deliberate: Xero never emails a draft, so nothing reaches the client
 * until someone approves and sends it from Xero.
 *
 * Both one-time fees and the first month of any retainer are invoiced, each line
 * coded to its own revenue account: one-time to the service's sales account,
 * recurring to the MRR account. If any line cannot be coded, NO invoice is
 * created and the reason names the offending lines, because a miscoded line is
 * worse than a missing draft when the whole point is per-account reporting.
 */

type LineItem = {
  name: string;
  description: string | null;
  one_time_price: number | string | null;
  monthly_price: number | string | null;
  xero_service_key: string | null;
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

/** Mirrors computeProposalTotals in src/lib/proposal-pricing.ts. The discount is
 * per bucket, and a 'fixed' discount applies its full value to EACH bucket it
 * covers, so the invoice total matches what the client saw on the proposal. */
function bucketDiscount(
  subtotal: number,
  type: string | null,
  value: number,
  applies: boolean,
): number {
  if (!applies || type === "none" || !type || value <= 0 || subtotal <= 0) return 0;
  if (type === "fixed") return Math.min(value, subtotal);
  if (type === "percent") return (subtotal * Math.min(Math.max(value, 0), 100)) / 100;
  return 0;
}

type PreparedLine = {
  description: string;
  gross: number;
  kind: "one_time" | "monthly";
  accountCode: string;
};

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
    .select("name, description, one_time_price, monthly_price, xero_service_key, display_order")
    .eq("proposal_id", proposalId);
  const items = ((itemRows ?? []) as LineItem[])
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const oneTimeSubtotal = items.reduce((s, i) => s + (num(i.one_time_price) ?? 0), 0);
  const monthlySubtotal = items.reduce((s, i) => s + (num(i.monthly_price) ?? 0), 0);
  if (oneTimeSubtotal <= 0 && monthlySubtotal <= 0) return { ok: false, error: "no_billable_fees" };

  const dType = proposal.discount_type ?? "none";
  const dValue = num(proposal.discount_value) ?? 0;
  const appliesTo = proposal.discount_applies_to ?? "one_time";
  const oneTimeDiscount = bucketDiscount(
    oneTimeSubtotal,
    dType,
    dValue,
    appliesTo === "one_time" || appliesTo === "both",
  );
  const monthlyDiscount = bucketDiscount(
    monthlySubtotal,
    dType,
    dValue,
    appliesTo === "monthly" || appliesTo === "both",
  );
  if (
    oneTimeDiscount >= oneTimeSubtotal && monthlyDiscount >= monthlySubtotal
  ) {
    // A 100% discount would post a zero invoice, which is never intended.
    return { ok: false, error: "fully_discounted" };
  }

  const conn = await loadConnection(sb);
  const defaults: AccountDefaults = {
    mrrAccountCode: conn?.mrr_account_code ?? null,
    salesAccountCode: conn?.sales_account_code ?? null,
  };
  const { data: mappingRows } = await sb
    .from("xero_revenue_accounts")
    .select("service_key, name, one_time_account_code, monthly_account_code");
  const mapping = (mappingRows ?? []) as RevenueAccountRow[];

  // Resolve every line's account BEFORE building anything, so a single unmapped
  // line stops the whole invoice instead of posting a partial one.
  const failures: Extract<Resolved, { ok: false }>[] = [];
  const prepared: PreparedLine[] = [];
  const ratio = (subtotal: number, discount: number) => (subtotal > 0 ? (subtotal - discount) / subtotal : 1);
  const oneTimeRatio = ratio(oneTimeSubtotal, oneTimeDiscount);
  const monthlyRatio = ratio(monthlySubtotal, monthlyDiscount);

  for (const item of items) {
    const label = item.name?.trim() || "Untitled line";
    const detail = [label, item.description?.trim()].filter(Boolean).join(" - ").slice(0, 4000);
    for (const kind of ["one_time", "monthly"] as const) {
      const gross = num(kind === "one_time" ? item.one_time_price : item.monthly_price) ?? 0;
      if (gross <= 0) continue;
      const resolved = resolveAccountCode(
        { label, serviceKey: item.xero_service_key, kind },
        mapping,
        defaults,
      );
      if (!resolved.ok) {
        failures.push(resolved);
        continue;
      }
      prepared.push({
        description: kind === "monthly" ? `${detail} (first month)`.slice(0, 4000) : detail,
        gross: gross * (kind === "one_time" ? oneTimeRatio : monthlyRatio),
        kind,
        accountCode: resolved.accountCode,
      });
    }
  }

  if (failures.length > 0) return { ok: false, error: describeUnmapped(failures) };
  if (prepared.length === 0) return { ok: false, error: "no_billable_fees" };

  const lineItems = prepared.map((p) => ({
    Description: p.description,
    Quantity: 1,
    // Xero recomputes totals from UnitAmount, so the discount is folded into the
    // unit price proportionally rather than sent as a separate field.
    UnitAmount: Math.round(p.gross * 100) / 100,
    AccountCode: p.accountCode,
    ...(conn?.tax_type ? { TaxType: conn.tax_type } : {}),
  }));

  const reference = proposal.proposal_number
    ? `ECD-${String(proposal.proposal_number).padStart(4, "0")}`
    : proposal.title;
  const totalDiscount = oneTimeDiscount + monthlyDiscount;
  const recurring = prepared.filter((p) => p.kind === "monthly");
  const notes = [
    `Created automatically from signed proposal ${reference}.`,
    totalDiscount > 0
      ? `A ${proposal.discount_label || "discount"} of ${
        totalDiscount.toFixed(2)
      } was applied proportionally across the lines.`
      : "",
    recurring.length > 0
      ? `Includes the FIRST MONTH of ${recurring.length} recurring item(s). Set up a Xero repeating invoice for the months after this one.`
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
