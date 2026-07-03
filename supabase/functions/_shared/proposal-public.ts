import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const PUBLIC_TOKEN_RE = /^[0-9a-f]{24}$/;

export const PROPOSAL_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function proposalJson(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...PROPOSAL_CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

type LineItemRow = {
  id: string;
  name: string;
  description: string;
  content: string;
  one_time_price: number | string | null;
  one_time_label: string | null;
  monthly_price: number | string | null;
  monthly_label: string | null;
  image_url: string | null;
  display_order: number;
};

type DiscountFields = {
  discount_type: "none" | "fixed" | "percent";
  discount_value: number | string;
  discount_applies_to: "one_time" | "monthly" | "both";
};

export type ProposalTotals = {
  oneTimeSubtotal: number;
  monthlySubtotal: number;
  oneTimeDiscount: number;
  monthlyDiscount: number;
  oneTimeTotal: number;
  monthlyTotal: number;
};

function numeric(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Mirror of src/lib/proposal-pricing.ts computeProposalTotals; the sign function
 * recomputes totals server-side and freezes them into the signed event metadata. */
export function computeProposalTotals(items: LineItemRow[], discount: DiscountFields): ProposalTotals {
  let oneTimeSubtotal = 0;
  let monthlySubtotal = 0;
  for (const item of items) {
    const oneTime = numeric(item.one_time_price);
    const monthly = numeric(item.monthly_price);
    if (oneTime) oneTimeSubtotal += oneTime;
    if (monthly) monthlySubtotal += monthly;
  }

  const value = Number(discount.discount_value) || 0;
  const unitDiscount = (subtotal: number, applies: boolean): number => {
    if (!applies || discount.discount_type === "none" || value <= 0 || subtotal <= 0) return 0;
    if (discount.discount_type === "fixed") return Math.min(value, subtotal);
    const pct = Math.min(Math.max(value, 0), 100);
    return (subtotal * pct) / 100;
  };

  const oneTimeDiscount = unitDiscount(
    oneTimeSubtotal,
    discount.discount_applies_to === "one_time" || discount.discount_applies_to === "both",
  );
  const monthlyDiscount = unitDiscount(
    monthlySubtotal,
    discount.discount_applies_to === "monthly" || discount.discount_applies_to === "both",
  );

  return {
    oneTimeSubtotal,
    monthlySubtotal,
    oneTimeDiscount,
    monthlyDiscount,
    oneTimeTotal: Math.max(0, oneTimeSubtotal - oneTimeDiscount),
    monthlyTotal: Math.max(0, monthlySubtotal - monthlyDiscount),
  };
}

/** Deterministic snapshot of exactly what the client saw and agreed to at signing
 * time: content, pricing, and contract text, but not administrative/mutable fields
 * like status or timestamps. Hashed and frozen into the "signed" event so any later
 * edit to the proposal or contract docs is detectable against what was signed. */
export function buildSignedPayloadSnapshot(
  proposal: {
    title: string;
    content_blocks: unknown;
    include_contracts: unknown;
    contracts_snapshot: unknown;
    discount_type: string;
    discount_value: number | string;
    discount_applies_to: string;
    discount_label: string | null;
  },
  lineItems: LineItemRow[],
  totals: ProposalTotals,
) {
  return {
    title: proposal.title,
    content_blocks: proposal.content_blocks ?? [],
    include_contracts: proposal.include_contracts ?? [],
    contracts_snapshot: proposal.contracts_snapshot ?? [],
    discount_type: proposal.discount_type,
    discount_value: Number(proposal.discount_value ?? 0),
    discount_applies_to: proposal.discount_applies_to,
    discount_label: proposal.discount_label ?? null,
    line_items: lineItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      content: item.content,
      one_time_price: numeric(item.one_time_price),
      one_time_label: item.one_time_label ?? null,
      monthly_price: numeric(item.monthly_price),
      monthly_label: item.monthly_label ?? null,
      display_order: item.display_order,
    })),
    totals,
  };
}

/** SHA-256 hex digest of a JSON-serializable value, used as a tamper-evidence
 * fingerprint for what was signed (JSON.stringify preserves object key insertion
 * order, so the same input always produces the same hash). */
export async function hashSignedPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isProposalExpired(proposal: { status: string; valid_until: string | null }): boolean {
  if (proposal.status !== "sent" && proposal.status !== "viewed") return false;
  if (!proposal.valid_until) return false;
  const validUntil = new Date(`${proposal.valid_until}T23:59:59`);
  return Number.isFinite(validUntil.getTime()) && validUntil < new Date();
}

/** Fetch a proposal by public token with its public-safe relations. Returns null for
 * unknown tokens AND drafts (indistinguishable to callers; no status oracle). */
export async function fetchPublicProposal(sb: SupabaseClient, token: string) {
  if (!PUBLIC_TOKEN_RE.test(token)) return null;

  const { data: proposal, error } = await sb
    .from("proposals")
    .select("*, client:clients(company_name, website_url)")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal || proposal.status === "draft") return null;

  const [{ data: lineItems, error: liErr }, { data: signatures, error: sigErr }] = await Promise.all([
    sb
      .from("proposal_line_items")
      .select("id, name, description, content, one_time_price, one_time_label, monthly_price, monthly_label, image_url, display_order")
      .eq("proposal_id", proposal.id)
      .order("display_order", { ascending: true }),
    sb
      .from("proposal_signatures")
      .select("role, signer_name, signature_image, signed_at")
      .eq("proposal_id", proposal.id),
  ]);
  if (liErr) throw liErr;
  if (sigErr) throw sigErr;

  return { proposal, lineItems: (lineItems ?? []) as LineItemRow[], signatures: signatures ?? [] };
}

/** Public payload: only fields the client-facing page needs (including recipient_email,
 * used to pre-fill the sign form -- whoever holds this link already has that address);
 * never internal notes, created_by, or the event log. */
export async function serializePublicProposal(
  sb: SupabaseClient,
  bundle: NonNullable<Awaited<ReturnType<typeof fetchPublicProposal>>>,
) {
  const { proposal, lineItems, signatures } = bundle;

  const { data: settingsRow } = await sb
    .from("platform_settings")
    .select("proposal_settings")
    .eq("id", "default")
    .maybeSingle();
  const settings = (settingsRow?.proposal_settings ?? {}) as Record<string, unknown>;

  const totals = computeProposalTotals(lineItems, proposal);
  const expired = isProposalExpired(proposal);

  return {
    proposal: {
      proposal_number: proposal.proposal_number,
      title: proposal.title,
      status: proposal.status,
      cover: proposal.cover ?? {},
      content_blocks: proposal.content_blocks ?? [],
      include_contracts: proposal.include_contracts ?? [],
      contracts_snapshot: proposal.contracts_snapshot ?? [],
      discount_type: proposal.discount_type,
      discount_value: Number(proposal.discount_value ?? 0),
      discount_applies_to: proposal.discount_applies_to,
      discount_label: proposal.discount_label,
      recipient_name: proposal.recipient_name,
      recipient_email: proposal.recipient_email,
      valid_until: proposal.valid_until,
      sent_at: proposal.sent_at,
      created_at: proposal.created_at,
      client_signed_at: proposal.client_signed_at,
      countersigned_at: proposal.countersigned_at,
    },
    client: {
      company_name: proposal.client?.company_name ?? "",
      website_url: proposal.client?.website_url ?? null,
    },
    line_items: lineItems,
    signatures,
    totals,
    expired,
    settings: { cover: (settings.cover as Record<string, unknown>) ?? {} },
  };
}
