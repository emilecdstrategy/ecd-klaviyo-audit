// Repeat-rate regressions. Run with: npx deno test supabase/functions/_shared/
//
// The shipped version of this metric read Shopify's LIFETIME order count per
// customer, which is reported as it stands today rather than as of the order
// date. Every past period therefore inflated the longer it sat there, and Power
// Planter looked like it had lost 45% of its repeat business when nothing had
// changed. These cases pin the properties that stop that happening again.
import { computeRepeat, REPEAT_LOOKBACK_DAYS } from "./repeat-rate.ts";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed, so the cases never drift
const CURRENT_SINCE = NOW - 30 * DAY;
const PRIOR_START = NOW - 60 * DAY;

/** An order N days before "now". */
const order = (daysAgo: number, customerId: string | null) => ({
  created_ms: NOW - daysAgo * DAY,
  customerId,
});

function rate(counts: { returning: number; identified: number }): number | null {
  return counts.identified > 0 ? Math.round((counts.returning / counts.identified) * 1000) / 10 : null;
}

function assertEq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: got ${a}, expected ${e}`);
}

Deno.test("a first-ever order is not returning, however much the customer buys later", () => {
  // The exact failure of the old measurement: c1's first order sits in the prior
  // period and they bought twice afterwards, so a lifetime counter called it
  // returning. It was their first purchase.
  const orders = [
    order(45, "c1"), // first ever, prior period
    order(20, "c1"), // current period, genuinely a repeat
    order(5, "c1"), // current period, genuinely a repeat
  ];
  const r = computeRepeat(orders, CURRENT_SINCE, PRIOR_START);
  assertEq(r.previous, { returning: 0, identified: 1 }, "prior period");
  assertEq(r.current, { returning: 2, identified: 2 }, "current period");
});

Deno.test("both periods are measured on the same lookback", () => {
  // One customer buys every 10 days across both periods. Every order except the
  // very first has a predecessor within the lookback, so the rate should be the
  // same on both sides rather than drifting with age.
  const orders = [];
  for (let d = 175; d >= 5; d -= 10) orders.push(order(d, "c1"));
  const r = computeRepeat(orders, CURRENT_SINCE, PRIOR_START);
  assertEq(rate(r.current), 100, "current rate");
  assertEq(rate(r.previous), 100, "prior rate");
});

Deno.test("a gap longer than the lookback is not a repeat", () => {
  const tooOld = REPEAT_LOOKBACK_DAYS + 20;
  const r = computeRepeat([order(10 + tooOld, "c1"), order(10, "c1")], CURRENT_SINCE, PRIOR_START);
  assertEq(r.current, { returning: 0, identified: 1 }, "beyond the lookback");

  const justInside = REPEAT_LOOKBACK_DAYS - 5;
  const r2 = computeRepeat([order(10 + justInside, "c1"), order(10, "c1")], CURRENT_SINCE, PRIOR_START);
  assertEq(r2.current, { returning: 1, identified: 1 }, "inside the lookback");
});

Deno.test("history outside the reported periods counts as history, not as orders", () => {
  // The 120 days before the prior period exist purely to give the lookback
  // something to see. They must never appear in a reported denominator.
  const r = computeRepeat([order(150, "c1"), order(120, "c1")], CURRENT_SINCE, PRIOR_START);
  assertEq(r.current, { returning: 0, identified: 0 }, "current");
  assertEq(r.previous, { returning: 0, identified: 0 }, "previous");
});

Deno.test("orders with no customer leave the denominator entirely", () => {
  // Guest checkouts are unknowable, not first-time. Counting them as new would
  // depress the rate by however much of the store checks out as a guest.
  const r = computeRepeat(
    [order(50, "c1"), order(10, "c1"), order(9, null), order(8, null)],
    CURRENT_SINCE,
    PRIOR_START,
  );
  assertEq(r.current, { returning: 1, identified: 1 }, "guests excluded");
  assertEq(rate(r.current), 100, "rate ignores guests");
});

Deno.test("two lines of the same basket are one order, not a repeat", () => {
  // Identical timestamps must not make an order its own predecessor.
  const same = order(10, "c1");
  const r = computeRepeat([same, { ...same }], CURRENT_SINCE, PRIOR_START);
  assertEq(r.current, { returning: 0, identified: 2 }, "same instant");
});

Deno.test("a period with no attributable orders has no rate at all", () => {
  const r = computeRepeat([order(200, "c1")], CURRENT_SINCE, PRIOR_START);
  assertEq(rate(r.current), null, "no rate");
});
