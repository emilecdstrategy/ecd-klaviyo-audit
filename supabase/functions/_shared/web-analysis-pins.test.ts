// Pin placement regressions. Run with: npx deno test supabase/functions/_shared/
//
// Every case here is a pin that once landed on the wrong thing in a report a
// client read. A wrong pin is worse than no pin, because it is a claim about
// where the problem is and the reader checks it against the screenshot.
import { asArray, coerceAnalytics, coercePageAudit, isBannedWork, isDiagnosticStep, PAGE_AUDIT_TOOL, type ElementBox } from "./web-analysis-schemas.ts";

/** A Shopify homepage header, as the capture actually records it. The logo lives
 * in an anonymous <a> inside an <h1>, so both carry bare tag names for labels. */
const HOMEPAGE_ELEMENTS: ElementBox[] = [
  { id: "el_5", label: "header: +1 979-922-5347 PRODUCT SPOTLIGHT WELDING", x: 0, y: 5, w: 100, h: 15.3 },
  { id: "el_6", label: "h1", x: 1.4, y: 7.7, w: 6.3, h: 12.7 },
  { id: "el_7", label: "a", x: 1.4, y: 7.7, w: 6.3, h: 10 },
  { id: "el_8", label: "nav: PRODUCT SPOTLIGHT WELDING HOODS UMBRELLAS", x: 17, y: 7.7, w: 60, h: 12.7 },
  { id: "el_40", label: "p: THE STANDARD BY WHICH ALL OTHERS ARE MEASURED", x: 30, y: 45, w: 40, h: 3 },
  { id: "el_44", label: "a: SHOP HOODS", x: 49.7, y: 53.7, w: 12, h: 5.7 },
];

/** Resolve one highlight the way the pipeline does, and report where it landed. */
function pinFor(highlight: Record<string, unknown>, findingText: string): string {
  const out = coercePageAudit(
    { findings: [{ text: findingText, recommendation: "x", viewport: "desktop", highlights: [highlight] }] },
    new Map([["IMG_1", "snap-desktop"]]),
    new Map([["IMG_1", HOMEPAGE_ELEMENTS]]),
    new Map([["IMG_1", "desktop"]]),
  );
  const hl = (out.findings[0]?.highlights ?? [])[0];
  return hl ? `${hl.x},${hl.y} ${hl.w}x${hl.h}` : "NO PIN";
}

function assertPin(actual: string, expected: string, what: string) {
  if (actual !== expected) throw new Error(`${what}: got ${actual}, expected ${expected}`);
}

const LOGO = "1.4,7.7 6.3x10";
const HERO_FINDING =
  "The headline and hero photo do a good job showing welding gear, but there is no price, rating, or specific product claim to back up the premium promise.";

Deno.test("an anonymous element_id with nothing to corroborate it is refused", () => {
  // The live failure: the model answered element_id el_7 for a hero finding, and
  // el_7 is the logo. Its label is the bare tag "a", so there was no text to
  // contradict the choice and the pin sat on the logo.
  const pin = pinFor({ image_ref: "IMG_1", element_id: "el_7", label: "Subheadline text" }, HERO_FINDING);
  if (pin === LOGO) throw new Error("pinned the logo for a hero finding");
  assertPin(pin, "NO PIN", "hero finding with a bad anonymous id");
});

Deno.test("the model's own box wins over an anonymous id it disagrees with", () => {
  assertPin(
    pinFor(
      { image_ref: "IMG_1", element_id: "el_7", label: "Subheadline text", x: 30, y: 45, w: 40, h: 4 },
      HERO_FINDING,
    ),
    "30,45 40x4",
    "box over the hero",
  );
});

Deno.test("an anonymous element is still pinnable when pointed at twice", () => {
  // Nothing wrong with pinning the logo when the finding IS about the logo and
  // the model's box agrees with the id. Refusing this would lose real pins.
  assertPin(
    pinFor(
      { image_ref: "IMG_1", element_id: "el_7", label: "Logo", x: 2, y: 8, w: 5, h: 8 },
      "The logo is cramped against the navigation.",
    ),
    LOGO,
    "logo finding, id and box agree",
  );
});

Deno.test("an element_id whose label carries text is trusted", () => {
  // "Main navigation menu" shares no distinctive word with the nav's own label,
  // which is why corroborating by label alone once dropped this correct pin.
  assertPin(
    pinFor(
      { image_ref: "IMG_1", element_id: "el_8", label: "Main navigation menu" },
      "The desktop navigation is packed with seven top-level menus.",
    ),
    "17,7.7 60x12.7",
    "nav by id",
  );
});

Deno.test("a label with no id still snaps to the named element", () => {
  assertPin(
    pinFor(
      { image_ref: "IMG_1", label: "SHOP HOODS button" },
      "The hero buttons send shoppers to two categories.",
    ),
    "49.7,53.7 12x5.7",
    "shop hoods by label",
  );
});

Deno.test("a label that only shares a content-type word snaps to nothing", () => {
  // "text", "area", "content" and friends describe a kind of content, not which
  // element is meant, so sharing one is not evidence of identity.
  assertPin(
    pinFor({ image_ref: "IMG_1", label: "Hero text area" }, "Something vague about the page."),
    "NO PIN",
    "content-type words only",
  );
});

// --- Self-cancelling findings ---------------------------------------------

/** Coerce one finding and report whether it survived. */
function survives(text: string, recommendation: string): boolean {
  const out = coercePageAudit(
    { findings: [{ text, recommendation, viewport: "desktop" }] },
    new Map([["IMG_1", "snap-desktop"]]),
    new Map([["IMG_1", HOMEPAGE_ELEMENTS]]),
    new Map([["IMG_1", "desktop"]]),
  );
  return (out.findings ?? []).length > 0;
}

Deno.test("a finding that retracts itself mid-sentence is dropped", () => {
  // Shipped in a live report: the fix admitted the gap was an artifact of the
  // single test item we added ourselves, then asked for a change anyway.
  const kept = survives(
    "The cart has a lot of empty space between the single item and the total on desktop.",
    "This is only because we tested with one item in the cart, so no change is needed for that specific gap, but consider whether the recommended items panel could shift up.",
  );
  if (kept) throw new Error("kept a finding whose own fix says no change is needed");
});

Deno.test("a real finding with a real fix survives", () => {
  const kept = survives(
    "The desktop navigation wraps onto a second row.",
    "Shorten the longest labels so every category fits on one row.",
  );
  if (!kept) throw new Error("dropped a legitimate finding");
});

Deno.test("a fix that merely mentions a test elsewhere still survives", () => {
  // Guard against the new patterns being too greedy.
  const kept = survives(
    "The hero has two equally weighted buttons.",
    "Make one button primary and test the wording against the current pair.",
  );
  if (!kept) throw new Error("the no-op filter is too greedy");
});

/** Coerce one finding for a given page type. */
function survivesOn(pageType: string, text: string, recommendation: string): boolean {
  const out = coercePageAudit(
    { findings: [{ text, recommendation, viewport: "desktop" }] },
    new Map([["IMG_1", "snap-desktop"]]),
    new Map([["IMG_1", HOMEPAGE_ELEMENTS]]),
    new Map([["IMG_1", "desktop"]]),
    pageType,
  );
  return (out.findings ?? []).length > 0;
}

Deno.test("'nothing to fix here, but...' is still a retraction", () => {
  // Second wording the model reached for after the first was blocked.
  const kept = survives(
    "The cart has a lot of empty black space between the single line item and the totals.",
    "Nothing to fix here since a real shopper's basket will naturally fill this space, but if you want to tighten it visually, cap the line-item area's minimum height.",
  );
  if (kept) throw new Error("kept a finding whose fix opens with nothing to fix");
});

Deno.test("cart emptiness is refused outright, however it is worded", () => {
  // No retraction to catch this time: a confident, actionable fix for a gap that
  // only exists because we added one test item.
  const kept = survivesOn(
    "cart",
    "The drawer looks sparse with a large gap under the single item.",
    "Cap the line-item area's minimum height so the totals sit closer to the product.",
  );
  if (kept) throw new Error("kept a cart emptiness finding");
});

Deno.test("the same wording is allowed on a page that is not the cart", () => {
  // A homepage hero really can have too much dead space; the refusal is
  // cart-specific because only the cart's contents are ours.
  const kept = survivesOn(
    "homepage",
    "The hero leaves a large gap between the headline and the buttons.",
    "Tighten the vertical spacing so the buttons sit within the first screen.",
  );
  if (!kept) throw new Error("the cart refusal leaked onto other pages");
});

// --- the mobile "no pins at all" failure -----------------------------------
//
// A live audit shipped a mobile screenshot with zero pins on six findings. Two
// causes met: the capture handed the model anonymous ids for the header icons,
// and an anonymous id with no box of its own is refused on purpose. Refusing is
// right; arriving with no box is what had to change.

/** A phone header as the capture records it once labelled elements win a box
 *  collision: the cart keeps its own name instead of losing it to a wrapper. */
const PHONE_ELEMENTS: ElementBox[] = [
  { id: "el_1", label: "a: FREE SHIPPING ON US ORDERS $100+", x: 12, y: 1, w: 76, h: 2.2 },
  { id: "el_2", label: "header", x: 0, y: 3.5, w: 100, h: 6 },
  { id: "el_3", label: "a: search", x: 47, y: 4, w: 12, h: 5 },
  { id: "el_4", label: "a: Log in", x: 60, y: 4, w: 12, h: 5 },
  { id: "el_5", label: "a: icon-cart", x: 73, y: 4, w: 12, h: 5 },
  { id: "el_6", label: "button: menu", x: 86, y: 4, w: 12, h: 5 },
];

function phonePin(highlight: Record<string, unknown>, findingText: string): string {
  const out = coercePageAudit(
    { findings: [{ text: findingText, recommendation: "x", viewport: "mobile", highlights: [highlight] }] },
    new Map([["IMG_1", "snap-mobile"]]),
    new Map([["IMG_1", PHONE_ELEMENTS]]),
    new Map([["IMG_1", "mobile"]]),
  );
  const hl = out.findings[0]?.highlights?.[0];
  return hl ? `${hl.label} @ ${Math.round(hl.x)},${Math.round(hl.y)}` : "NO PIN";
}

const HEADER_FINDING = "The phone header bunches search, account, cart and menu all on the right, leaving the left side empty.";

Deno.test("a header finding pins to the cart once the cart keeps its own label", () => {
  // Before the capture fix this element arrived as a bare "div" and the pin was
  // refused, which is how a whole section shipped with nothing on it.
  const pin = phonePin(
    { image_ref: "IMG_1", element_id: "el_5", label: "Cart icon", x: 73, y: 4, w: 12, h: 5 },
    HEADER_FINDING,
  );
  if (pin === "NO PIN") throw new Error("the cart is named and boxed, so this must pin");
  if (!pin.includes("73")) throw new Error(`expected the cart's own box, got ${pin}`);
});

Deno.test("a finding about something with no matching element still gets its box", () => {
  // Nothing in the list is the overflowing hero image, so the model's own box is
  // all there is. Dropping it leaves the reader with a claim and no pin.
  const pin = phonePin(
    { image_ref: "IMG_1", label: "Hero promo cropped at the right edge", x: 20, y: 22, w: 78, h: 40 },
    "On phones, the hero banner opens on a promo that is cropped off screen so the offer and button are unreadable.",
  );
  if (pin === "NO PIN") throw new Error("a boxed highlight with no element must still pin");
});

Deno.test("the highlight schema demands a box on every entry", () => {
  // The resolver needs a box to check an element_id against, and needs one to
  // fall back to. The schema used to call x/y/w/h "fallback only", which told
  // the model not to send them, and an anonymous id then resolved to nothing at
  // all. Contract and resolver have to agree.
  const props = (PAGE_AUDIT_TOOL.input_schema as {
    properties: { findings: { items: { properties: { highlights: { items: { required?: string[] } } } } } };
  }).properties.findings.items.properties.highlights.items;
  for (const key of ["image_ref", "x", "y", "w", "h"]) {
    if (!props.required?.includes(key)) throw new Error(`highlights must require ${key}`);
  }
});

// --- the reply that arrived in the wrong shape ------------------------------
//
// A live audit stopped with "web_product_page: incomplete after both passes
// (0 findings, intro present)". The model had written a full audit and sent
// findings, pros and recommendations as JSON-encoded strings, both passes. Every
// array-typed field was read with a bare Array.isArray check, so the whole reply
// was discarded and the section looked empty.

Deno.test("findings JSON-encoded into a string are recovered whole", () => {
  const real = [
    { text: "The buy button sits below the fold on phones.", recommendation: "Move it up.", viewport: "mobile" },
    { text: "No reviews anywhere on the page.", recommendation: "Add a review block.", viewport: "both" },
  ];
  const out = coercePageAudit(
    { intro: "A tidy page.", findings: JSON.stringify(real), pros: '["Clear photos","Fast"]', recommendations: '["Move the button","Add reviews"]' },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "mobile"]]),
  );
  if (out.findings.length !== 2) throw new Error(`expected 2 findings, got ${out.findings.length}`);
  if (out.pros.length !== 2) throw new Error(`expected 2 pros, got ${out.pros.length}`);
  if (out.recommendations.length !== 2) throw new Error(`expected 2 recommendations, got ${out.recommendations.length}`);
  if (!out.findings[0].text.includes("buy button")) throw new Error("the finding text did not survive");
});

Deno.test("a single finding sent unwrapped is still a finding", () => {
  const out = coercePageAudit(
    { intro: "x", findings: { text: "The price is hard to find.", recommendation: "Make it bigger.", viewport: "both" } },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "desktop"]]),
  );
  if (out.findings.length !== 1) throw new Error(`expected 1 finding, got ${out.findings.length}`);
});

Deno.test("prose pros and recommendations are split back into items", () => {
  const out = coercePageAudit(
    { intro: "x", findings: [], pros: "- Clear photography\n- Fast to load\n- Honest copy", recommendations: "1. Move the button\n2. Add reviews" },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "desktop"]]),
  );
  if (out.pros.length !== 3) throw new Error(`expected 3 pros, got ${JSON.stringify(out.pros)}`);
  if (out.recommendations.length !== 2) throw new Error(`expected 2 recommendations, got ${JSON.stringify(out.recommendations)}`);
  if (out.pros[0] !== "Clear photography") throw new Error(`bullet not stripped: ${out.pros[0]}`);
  if (out.recommendations[0] !== "Move the button") throw new Error(`number not stripped: ${out.recommendations[0]}`);
});

Deno.test("recovery never invents a finding out of prose", () => {
  // A finding needs both a claim and a fix. Splitting a paragraph into
  // sentences would manufacture recommendations nobody wrote, so this case
  // stays empty on purpose and the retry asks again.
  const out = coercePageAudit(
    { intro: "x", findings: "The hero is weak and the button is unclear and there are no reviews." },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "desktop"]]),
  );
  if (out.findings.length !== 0) throw new Error("prose must not become findings");
});

Deno.test("asArray leaves a real array alone and ignores junk", () => {
  if (asArray([1, 2]).length !== 2) throw new Error("an array must pass through");
  if (asArray(null).length !== 0) throw new Error("null is not a list");
  if (asArray("").length !== 0) throw new Error("an empty string is not a list");
  if (asArray("not json at all").length !== 0) throw new Error("prose is not a list");
  if (asArray("[bad json").length !== 0) throw new Error("broken json is not a list");
});

// --- advice we refuse to ship ---------------------------------------------
//
// A play arrived with three steps, all of them things to go and look at, led by
// "Audit product pages on a phone for load speed". The client is reading the
// audit: handing the work back is the opposite of the job, and page speed is
// not measured anywhere in this pipeline so we cannot stand behind it.

Deno.test("page speed work is refused however it is worded", () => {
  for (const line of [
    "Audit product pages on a phone for load speed and image clarity",
    "Compress your images to improve page speed",
    "Enable lazy loading on the collection grid",
    "Improve Core Web Vitals on mobile",
    "Reduce TTFB by putting the store behind a CDN",
    "Minify the theme CSS",
  ]) {
    if (!isBannedWork(line)) throw new Error(`should be refused: ${line}`);
  }
});

Deno.test("ordinary merchandising advice is untouched", () => {
  for (const line of [
    "Show the price and a star rating under each product card",
    "Raise the free shipping threshold to $150",
    "Add a quick add to cart button on the collection grid",
    "Pair the Auger Adapters with the Adapter Pins on both product pages",
  ]) {
    if (isBannedWork(line)) throw new Error(`should be kept: ${line}`);
    if (isDiagnosticStep(line)) throw new Error(`should be kept: ${line}`);
  }
});

Deno.test("a step that asks the client to go and investigate is refused", () => {
  for (const line of [
    "Audit product pages on a phone for load speed",
    "Review your product titles for clarity",
    "Analyse where visitors drop before adding to cart",
    "Investigate why desktop converts lower",
    "Run an audit of the checkout flow",
    "Measure the drop-off between cart and checkout",
  ]) {
    if (!isDiagnosticStep(line)) throw new Error(`should be refused: ${line}`);
  }
});

Deno.test("a play whose every step is refused is dropped entirely", () => {
  // A play with nothing to do is not a play. Dropping it is better than
  // printing a heading with no work under it.
  const out = coerceAnalytics({
    intro: "x",
    plays: [
      {
        title: "Fix the add-to-cart step first",
        insight: "Only 1.7% of sessions add to cart.",
        action_steps: [
          "Audit product pages on a phone for load speed",
          "Analyse where visitors drop before adding to cart",
        ],
        metric: "1.7%",
      },
      {
        title: "Raise the free shipping bar",
        insight: "The threshold sits below the median order.",
        action_steps: ["Raise the free shipping threshold to $150"],
        metric: "$100 vs $132.71",
      },
    ],
  });
  if (out.plays.length !== 1) throw new Error(`expected 1 play, got ${out.plays.length}`);
  if (out.plays[0].title !== "Raise the free shipping bar") throw new Error("kept the wrong play");
});

Deno.test("a play keeps its shippable steps and loses only the rest", () => {
  const out = coerceAnalytics({
    intro: "x",
    plays: [{
      title: "Lift the basket",
      insight: "Most orders carry one item.",
      action_steps: [
        "Audit the product pages for load speed",
        "Add a frequently bought together row to the product page",
      ],
      metric: "64%",
    }],
  });
  if (out.plays.length !== 1) throw new Error("the play should survive");
  if (out.plays[0].action_steps.length !== 1) throw new Error(`expected 1 step, got ${JSON.stringify(out.plays[0].action_steps)}`);
  if (!out.plays[0].action_steps[0].includes("frequently bought")) throw new Error("kept the wrong step");
});
