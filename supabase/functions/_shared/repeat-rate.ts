// How much of a store's business comes from people who had already bought.
//
// Kept apart from the fetcher because the definition is the whole subtlety here,
// and because it is worth testing directly: see repeat-rate.test.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back an order looks to decide whether its customer had bought before.
 *
 * Fixed, and identical for both reported periods, which is the entire point.
 *
 * The measurement this replaced asked Shopify for the customer's LIFETIME order
 * count, which is reported as it stands today rather than as of the order date.
 * An order from seven weeks ago therefore counted as returning if the customer
 * came back since, even when it was their first ever purchase, so every past
 * period inflated the longer it sat there. Power Planter read 43.5% for the prior
 * month against 23.9% for the current one and looked like a 45% collapse that
 * never happened.
 *
 * Giving every order the same 90-day lookback removes that drift. The fetch
 * window is 180 days and the reported periods cover only the most recent 60, so
 * even the oldest order in the prior period has a full 90 days of history behind
 * it. A shorter fetch window would hand the current period more history than the
 * period it is compared against, which is the same bug pointing the other way.
 */
export const REPEAT_LOOKBACK_DAYS = 90;

export type RepeatCounts = {
  current: { returning: number; identified: number };
  previous: { returning: number; identified: number };
};

export type RepeatOrder = { created_ms: number; customerId?: string | null };

/**
 * Repeat-purchase counts per period.
 *
 * "Returning" means the same customer has an earlier order within
 * REPEAT_LOOKBACK_DAYS of this one. Because every order is judged on the same
 * lookback, the two periods are comparable and a move in the number means a move
 * in behaviour rather than a move in how much history had piled up.
 *
 * Orders with no customer attached (guest checkout, or read_customers absent) are
 * left out of both the numerator and the denominator. Treating them as first-time
 * buyers would depress the rate by however much of the store checks out as a
 * guest, which is a property of the checkout rather than of loyalty.
 *
 * Orders older than the prior period are read as history and never counted as
 * orders: they exist so the lookback has something to see.
 */
export function computeRepeat(
  orders: RepeatOrder[],
  currentSinceMs: number,
  priorStartMs: number,
): RepeatCounts {
  const lookbackMs = REPEAT_LOOKBACK_DAYS * DAY_MS;

  const byCustomer = new Map<string, number[]>();
  for (const o of orders) {
    const id = o.customerId;
    if (!id) continue;
    const list = byCustomer.get(id);
    if (list) list.push(o.created_ms);
    else byCustomer.set(id, [o.created_ms]);
  }
  for (const list of byCustomer.values()) list.sort((x, y) => x - y);

  const counts: RepeatCounts = {
    current: { returning: 0, identified: 0 },
    previous: { returning: 0, identified: 0 },
  };

  for (const o of orders) {
    const id = o.customerId;
    if (!id) continue;
    const bucket = o.created_ms >= currentSinceMs
      ? counts.current
      : (o.created_ms >= priorStartMs ? counts.previous : null);
    if (!bucket) continue;
    bucket.identified += 1;
    const dates = byCustomer.get(id);
    if (!dates) continue;
    // Strictly earlier: two lines of one basket share a timestamp, and an order
    // must never count as its own predecessor.
    const hasPrior = dates.some((d) => d < o.created_ms && d >= o.created_ms - lookbackMs);
    if (hasPrior) bucket.returning += 1;
  }

  return counts;
}

/** The rate as a percentage, or null when nothing in the period could be
 *  attributed to a customer and there is therefore no rate to state. */
export function repeatRate(counts: { returning: number; identified: number }): number | null {
  if (counts.identified <= 0) return null;
  return Math.round((counts.returning / counts.identified) * 10000) / 100;
}
