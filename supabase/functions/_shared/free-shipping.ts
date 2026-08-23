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
/** The next round number above an amount: $10 steps once baskets are past $50,
 *  $5 below that. A threshold wants to look deliberate, not calculated. */
function nextRoundStepAbove(amount: number): number {
  const step = amount >= 50 ? 10 : 5;
  return Math.floor(amount / step) * step + step;
}

/**
 * Where the threshold belongs: JUST above the median.
 *
 * The point of a threshold is a gap the shopper in the middle of the pack can
 * see themselves closing, so they add one more thing. That means the number sits
 * a few dollars over the median, not somewhere out towards the top of the range.
 *
 * This used to aim 60% of the way from the median to the 75th percentile, which
 * on a real store (median $132.38, 75th $260.53) produced $210: the median
 * shopper had to find another $77.62 to qualify. Nobody does that, so the
 * threshold stops being a lever and just quietly excludes most of the basket
 * range. The next round number above the median asks that same shopper for about
 * eight dollars, which is the whole idea.
 */
export function thresholdAdvice(
  threshold: number,
  spread: OrderSpread,
): { direction: "raise" | "lower" | "leave"; target: number | null } {
  const { median, p75 } = spread;
  if (!median || median <= 0) return { direction: "leave", target: null };

  let target = nextRoundStepAbove(median);
  // Never past the 75th percentile: beyond it, three orders in four cannot reach
  // the threshold however round the number looks.
  if (p75 && p75 > median && target > p75) {
    target = Math.floor(p75 / 5) * 5;
  }

  if (threshold <= median) {
    // Raising must actually raise. On a store whose median sits just under a
    // round number the target can land on the current bar, and "raise it to what
    // it already is" is not a play.
    if (target <= threshold) return { direction: "leave", target: null };
    return { direction: "raise", target };
  }
  if (p75 && threshold > p75) {
    if (target >= threshold) return { direction: "leave", target: null };
    return { direction: "lower", target };
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
      return `${head}${spreadText} At $${threshold} it sits at or below the median, so nearly every order already clears it and it is pulling nobody's basket upward. RAISE it to $${advice.target}, and say raise: the number you name MUST be higher than $${threshold} and MUST be exactly $${advice.target}. That figure is the next round number above the median on purpose, so the shopper in the middle of the pack is only a few dollars short and adding one more item closes it. Do NOT pick a bigger number because the 75th percentile is high: a gap of fifty or eighty dollars is one no shopper closes, and it turns the offer into decoration.`;
    }
    if (advice.direction === "lower") {
      return `${head}${spreadText} At $${threshold} it sits above the 75th percentile, so three orders in four cannot reach it and it is decoration rather than an incentive. LOWER it to $${advice.target}, which is the next round number above the median: close enough that a typical basket is one small add away. The number you name MUST be lower than $${threshold} and MUST be exactly $${advice.target}, and you MUST call it lowering or reducing: describing a decrease as "raising the bar" is the single worst thing this section can say, because the reader checks the two numbers.`;
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
