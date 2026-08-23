import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { freeShippingNote, labelsFromSnapshots, readFreeShippingOffer, thresholdAdvice } from "./free-shipping.ts";

// A play told a store with no free shipping offer at all that "if your free
// shipping bar sits at or near $135 or below, most carts already clear it". The
// scan returned an empty string when it found no amount, so the model had
// nothing and hedged. A hedge reads as a finding, which makes it worse than
// silence, and silence was already bad.

Deno.test("an advertised threshold is read off the storefront's own words", () => {
  const offer = readFreeShippingOffer([
    "a: FREE SHIPPING ON US ORDERS $100+",
    "div: Total $54.00 USD",
  ]);
  assertEquals(offer, { state: "found", amounts: ["100"] });
});

Deno.test("several thresholds are all reported", () => {
  const offer = readFreeShippingOffer([
    "a: Free shipping over $75",
    "p: Free delivery on orders above $150 in Canada",
  ]);
  assert(offer.state === "found");
  assertEquals(offer.amounts.sort(), ["150", "75"]);
});

Deno.test("free shipping mentioned with no amount is not the same as none", () => {
  // "Free shipping available" tells us the offer exists but not its threshold.
  // Guessing a figure here would be inventing one.
  assertEquals(readFreeShippingOffer(["p: Free shipping available on select items"]), {
    state: "advertised_no_amount",
  });
});

Deno.test("the cart disclosure is not a free shipping offer", () => {
  // This was the whole store's shipping copy on a live audit, and it offers
  // nothing: it says the cost is worked out later.
  const offer = readFreeShippingOffer([
    "div: Total $14.99 USD Taxes and shipping calculated at checkout",
    "a: Checkout without shipping protection",
  ]);
  assertEquals(offer, { state: "none" });
});

Deno.test("a store with no shipping copy at all reports none", () => {
  assertEquals(readFreeShippingOffer(["h1: Drill Augers", "button: ADD TO CART"]), { state: "none" });
  assertEquals(readFreeShippingOffer([]), { state: "none" });
});

Deno.test("with no offer the note says introduce one above the average order", () => {
  const note = freeShippingNote({ state: "none" }, 43.5);
  assertStringIncludes(note, "none is advertised");
  assertStringIncludes(note, "INTRODUCE one");
  assertStringIncludes(note, "$43.5");
  // The exact hedge that shipped, forbidden by name.
  assertStringIncludes(note, "if your free shipping bar sits at or below X");
});

Deno.test("with no offer and no average order value the note still stands", () => {
  const note = freeShippingNote({ state: "none" }, null);
  assertStringIncludes(note, "INTRODUCE one");
  assert(!note.includes("$"), "no figure should be quoted when there is none to quote");
});

Deno.test("with a threshold the note asks for it against the percentiles", () => {
  const note = freeShippingNote({ state: "found", amounts: ["100"] }, 132);
  assertStringIncludes(note, "$100");
  assertStringIncludes(note, "order_value_percentiles");
  assert(!note.includes("INTRODUCE"), "there is nothing to introduce when one exists");
});

Deno.test("advertised without an amount forbids both plays", () => {
  const note = freeShippingNote({ state: "advertised_no_amount" }, 132);
  assertStringIncludes(note, "do not know what it is");
  assertStringIncludes(note, "Do NOT state or guess a figure");
});

Deno.test("labels are gathered from every snapshot", () => {
  const labels = labelsFromSnapshots([
    { elements: [{ id: "el_1", label: "a: FREE SHIPPING OVER $50", x: 0, y: 0, w: 1, h: 1 }] },
    { elements: [{ id: "el_2", label: "", x: 0, y: 0, w: 1, h: 1 }] },
    { elements: null },
    {},
  ]);
  assertEquals(labels, ["a: FREE SHIPPING OVER $50"]);
  assertEquals(readFreeShippingOffer(labels), { state: "found", amounts: ["50"] });
});

// --- which way should the threshold move -----------------------------------
//
// A play titled "Raise the free shipping bar" carried the step "Raise the free
// shipping threshold to $75" on a store whose threshold was $80.01. That is a
// reduction described as a raise, and the reader checks the two numbers. The
// direction is arithmetic, so it is no longer left to the model: the note names
// the direction and the target.

Deno.test("a threshold above the 75th percentile is lowered", () => {
  // The live case: $80.01 with a $40.60 median and a $62.95 75th percentile.
  const advice = thresholdAdvice(80.01, { median: 40.6, p75: 62.95 });
  assertEquals(advice.direction, "lower");
  assert(advice.target !== null && advice.target < 80.01, `target ${advice.target} must be below the current bar`);
  assert(advice.target! > 40.6, `target ${advice.target} must still be a stretch above the median`);
});

Deno.test("a threshold at or below the median is raised", () => {
  // Power Planter: $100 with a $132.71 median and a $267.58 75th percentile.
  const advice = thresholdAdvice(100, { median: 132.71, p75: 267.58 });
  assertEquals(advice.direction, "raise");
  assert(advice.target !== null && advice.target > 100, `target ${advice.target} must be above the current bar`);
});

Deno.test("a threshold already between the median and the 75th is left alone", () => {
  const advice = thresholdAdvice(55, { median: 40.6, p75: 62.95 });
  assertEquals(advice, { direction: "leave", target: null });
});

Deno.test("with no order spread there is no direction to give", () => {
  assertEquals(thresholdAdvice(80, { median: null, p75: null }), { direction: "leave", target: null });
});

Deno.test("the note says lower, and forbids calling it a raise", () => {
  const note = freeShippingNote({ state: "found", amounts: ["80.01"] }, 45, { median: 40.6, p75: 62.95 });
  assertStringIncludes(note, "LOWER it");
  assertStringIncludes(note, "MUST be lower than $80.01");
  assertStringIncludes(note, 'describing a decrease as "raising the bar"');
  assert(!note.includes("RAISE it"), "the note must not also say raise");
});

Deno.test("the note says raise when raising is right", () => {
  const note = freeShippingNote({ state: "found", amounts: ["100"] }, 150, { median: 132.71, p75: 267.58 });
  assertStringIncludes(note, "RAISE it");
  assertStringIncludes(note, "MUST be higher than $100");
  assert(!note.includes("LOWER it"), "the note must not also say lower");
});

Deno.test("a well-placed threshold gets no play at all", () => {
  const note = freeShippingNote({ state: "found", amounts: ["55"] }, 48, { median: 40.6, p75: 62.95 });
  assertStringIncludes(note, "where a threshold belongs");
  assertStringIncludes(note, "Do NOT write a play about moving it");
});

Deno.test("the lowest advertised threshold is the one shoppers chase", () => {
  // This store advertises $80.01 and $100; the $80.01 is the live target.
  const note = freeShippingNote({ state: "found", amounts: ["100", "80.01"] }, 45, { median: 40.47, p75: 58.14 });
  assertStringIncludes(note, "At $80.01");
  assertStringIncludes(note, "LOWER it");
});

Deno.test("without an order spread the note falls back to the old wording", () => {
  const note = freeShippingNote({ state: "found", amounts: ["100"] }, 150, { median: null, p75: null });
  assertStringIncludes(note, "order_value_percentiles");
  assert(!note.includes("RAISE it") && !note.includes("LOWER it"), "no direction without the numbers to derive one");
});

// --- how far above the median the target may sit -----------------------------
//
// A live report said "Raise the free shipping bar to $210" on a store whose
// median order was $132.38. The direction was right and the number was useless:
// the median shopper had to find another $77.62. The target is now the next
// round number above the median, which asks that shopper for about eight
// dollars.

Deno.test("the raise target is the next round number above the median", () => {
  const advice = thresholdAdvice(100, { median: 132.38, p75: 260.53 });
  assertEquals(advice.direction, "raise");
  assertEquals(advice.target, 140);
});

Deno.test("a high 75th percentile does not drag the target up with it", () => {
  // Same median, a far longer tail. The threshold belongs by the median either
  // way: the tail is a handful of big baskets, not the shopper being nudged.
  const advice = thresholdAdvice(100, { median: 132.38, p75: 900 });
  assertEquals(advice.target, 140);
  assert(advice.target! - 132.38 < 20, `gap ${advice.target! - 132.38} must stay small`);
});

Deno.test("the target never lands past the 75th percentile", () => {
  // A tight spread: the next $10 step above the median would exclude more than
  // three quarters of orders, so it is pulled back to the 75th.
  const advice = thresholdAdvice(100, { median: 132.38, p75: 135 });
  assertEquals(advice.direction, "raise");
  assert(advice.target! <= 135, `target ${advice.target} must not exceed the 75th percentile`);
});

Deno.test("small baskets step by five, not ten", () => {
  const advice = thresholdAdvice(30, { median: 40.6, p75: 62.95 });
  assertEquals(advice.direction, "raise");
  assertEquals(advice.target, 45);
});

Deno.test("a raise that would not actually raise is no play at all", () => {
  // Median $132.38 puts the next step at $140, which is where the bar already
  // is: nothing to say.
  assertEquals(thresholdAdvice(140, { median: 132.38, p75: 260.53 }).direction, "leave");
});
