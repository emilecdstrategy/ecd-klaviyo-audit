import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { freeShippingNote, labelsFromSnapshots, readFreeShippingOffer } from "./free-shipping.ts";

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
