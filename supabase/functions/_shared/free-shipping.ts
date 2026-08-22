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

/** Where the orders actually land, for deciding which way a threshold should move. */
export type OrderSpread = { median: number | null; p75: number | null };

/**
 * Which way should the threshold move, and to what?
 *
 * This is arithmetic, and leaving it to the model produced a play titled "Raise
 * the free shipping bar" whose step read "Raise the free shipping threshold to
 * $75" on a store whose threshold was $80.01. Lowering it by five dollars,
 * described as a raise. The model had been told that a threshold at or below the
 * median should be raised, and nothing at all about the opposite case, so it
 * reached for the only framing it had.
 *
 * Three cases, and only two of them are a play:
 *  - at or below the median: nearly every order already clears it, so it pulls
 *    no basket upward. Raise it to between the median and the 75th percentile.
 *  - above the 75th percentile: three orders in four cannot reach it, so it is
 *    decoration. Lower it to just above the median, where it is a real stretch.
 *  - between the two: it is where it should be. No play.
 */
export function thresholdAdvice(
  threshold: number,
  spread: OrderSpread,
): { direction: "raise" | "lower" | "leave"; target: number | null } {
  const { median, p75 } = spread;
  if (!median || median <= 0) return { direction: "leave", target: null };
  const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
  if (threshold <= median) {
    // Between the median and the 75th percentile: a stretch most shoppers can
    // make. Without a 75th percentile, half again over the median.
    const ceiling = p75 && p75 > median ? p75 : median * 1.5;
    return { direction: "raise", target: round5(median + (ceiling - median) * 0.6) };
  }
  if (p75 && threshold > p75) {
    return { direction: "lower", target: round5(median * 1.2) };
  }
  return { direction: "leave", target: null };
}

/** What the analysis is told about it. Never silence: silence is what produced
 *  the invented conditional. */
export function freeShippingNote(
  offer: FreeShippingOffer,
  aov: number | null,
  spread: OrderSpread = { median: null, p75: null },
): string {
  if (offer.state === "found") {
    const amounts = offer.amounts.map((a) => "$" + a).join(", ");
    const numeric = offer.amounts.map((a) => Number(a)).filter((n) => Number.isFinite(n) && n > 0);
    // The lowest advertised threshold is the one a shopper is actually chasing.
    const threshold = numeric.length > 0 ? Math.min(...numeric) : null;
    const head = `FREE SHIPPING: the storefront advertises it at ${amounts}, read off its own announcement bar, product page or cart.`;
    if (threshold === null || !spread.median) {
      return `${head} Compare that with basket.order_value_percentiles before suggesting a threshold change, and quote both numbers.`;
    }
    const spreadText = ` The median order is $${spread.median}${spread.p75 ? ` and the 75th percentile is $${spread.p75}` : ""}.`;
    const advice = thresholdAdvice(threshold, spread);
    if (advice.direction === "raise") {
      return `${head}${spreadText} At $${threshold} it sits at or below the median, so nearly every order already clears it and it is pulling nobody's basket upward. RAISE it, to about $${advice.target}, and say raise: the number you name MUST be higher than $${threshold}.`;
    }
    if (advice.direction === "lower") {
      return `${head}${spreadText} At $${threshold} it sits above the 75th percentile, so three orders in four cannot reach it and it is decoration rather than an incentive. LOWER it, to about $${advice.target}, which is a real stretch from the median rather than an impossible one. The number you name MUST be lower than $${threshold}, and you MUST call it lowering or reducing: describing a decrease as "raising the bar" is the single worst thing this section can say, because the reader checks the two numbers.`;
    }
    return `${head}${spreadText} At $${threshold} it sits between the median and the 75th percentile, which is where a threshold belongs: a stretch most shoppers can make. Do NOT write a play about moving it. If you want to write about free shipping at all, write about making the existing threshold more visible or about what to suggest adding to reach it.`;
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
