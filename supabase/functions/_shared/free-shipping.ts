import type { ElementBox } from "./web-analysis-schemas.ts";

/**
 * Does this store offer free shipping over a threshold, and at what?
 *
 * Shopify will not tell us: it lives in shipping settings and read_shipping is
 * not granted. But a store that has one advertises it, in the announcement bar,
 * on the product page or at the top of the cart, and we capture all three. So
 * the storefront's own words are the source.
 *
 * The distinction that matters is three-way, not two. Told nothing, the analysis
 * invented a conditional: "if your free shipping bar sits at or near $135 or
 * below, most carts already clear it" on a store with no free shipping at all.
 * A hedge like that is worse than silence, because it reads as a finding.
 */
export type FreeShippingOffer =
  /** Advertised, with the amounts we could read. */
  | { state: "found"; amounts: string[] }
  /** Advertised, but no amount appeared in what we captured. */
  | { state: "advertised_no_amount" }
  /** No free shipping offer anywhere in the captured pages. */
  | { state: "none" };

const OFFER_RE = /free\s*(shipping|delivery)|ships?\s+free|delivery\s+is\s+free/i;
const AMOUNT_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/;

/** Text that mentions shipping without offering it free. "Taxes and shipping
 *  calculated at checkout" and "shipping protection" are not offers. */
const NOT_AN_OFFER_RE = /calculated at (the )?checkout|shipping protection|protect(ion)? plan/i;

export function readFreeShippingOffer(labels: string[]): FreeShippingOffer {
  const amounts = new Set<string>();
  let advertised = false;
  for (const raw of labels) {
    const label = String(raw ?? "");
    if (!OFFER_RE.test(label)) continue;
    if (NOT_AN_OFFER_RE.test(label) && !AMOUNT_RE.test(label)) continue;
    advertised = true;
    const m = label.match(AMOUNT_RE);
    if (m) amounts.add(m[1].replace(/,/g, ""));
  }
  if (amounts.size > 0) return { state: "found", amounts: [...amounts] };
  return advertised ? { state: "advertised_no_amount" } : { state: "none" };
}

/** What the analysis is told about it. Never silence: silence is what produced
 *  the invented conditional. */
export function freeShippingNote(offer: FreeShippingOffer, aov: number | null): string {
  if (offer.state === "found") {
    return `FREE SHIPPING: the storefront advertises it at ${offer.amounts.map((a) => "$" + a).join(", ")}, read off its own announcement bar, product page or cart. Compare that with basket.order_value_percentiles before suggesting a threshold change, and quote both numbers.`;
  }
  if (offer.state === "advertised_no_amount") {
    return "FREE SHIPPING: the storefront mentions free shipping but no threshold amount appeared anywhere we captured, so we do not know what it is. Do NOT state or guess a figure, and do not write a play that depends on one. Say the threshold is not stated where a shopper can see it, which is itself worth fixing.";
  }
  const aovText = aov && aov > 0 ? ` The current average order value is $${aov}.` : "";
  return (
    "FREE SHIPPING: none is advertised anywhere in the captured pages, so this store almost certainly does not offer a free shipping threshold at all." +
    aovText +
    " So the play is to INTRODUCE one, not to change one. Set it at a round number just above the current average order value, name that average in the insight, and say what it should do: give the shopper a reason to add one more item. NEVER speculate about an existing threshold, and never write a conditional like \"if your free shipping bar sits at or below X\": a hedge like that reads as a finding and it is not one."
  );
}

/** Every label the capture recorded for an audit, for the reader above. */
export function labelsFromSnapshots(rows: Array<{ elements?: unknown }>): string[] {
  const out: string[] = [];
  for (const row of rows ?? []) {
    for (const el of ((row.elements ?? []) as ElementBox[])) {
      const label = String(el?.label ?? "");
      if (label) out.push(label);
    }
  }
  return out;
}
