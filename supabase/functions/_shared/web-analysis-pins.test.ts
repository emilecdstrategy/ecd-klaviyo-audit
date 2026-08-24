// Pin placement regressions. Run with: npx deno test supabase/functions/_shared/
//
// Every case here is a pin that once landed on the wrong thing in a report a
// client read. A wrong pin is worse than no pin, because it is a claim about
// where the problem is and the reader checks it against the screenshot.
import { asArray, assumesLayout, cartLooksPopulated, recommendsExistingFeature, coerceAnalytics, coercePageAudit, isBannedWork, isDiagnosticStep, PAGE_AUDIT_TOOL, presumesSetup, snapToElementByLabel, snapToElementGroup, snapToHeroPhoto, type ElementBox } from "./web-analysis-schemas.ts";

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

Deno.test("a header finding pins the icon row once the cart keeps its own label", () => {
  // Before the capture fix this element arrived as a bare "div" and the pin was
  // refused, which is how a whole section shipped with nothing on it. It now
  // resolves, and because the finding is about three icons bunched together the
  // pin covers the row rather than the one icon the model happened to name.
  const out = coercePageAudit(
    {
      findings: [{
        text: HEADER_FINDING,
        recommendation: "x",
        viewport: "mobile",
        highlights: [{ image_ref: "IMG_1", element_id: "el_5", label: "Cart icon", x: 73, y: 4, w: 12, h: 5 }],
      }],
    },
    new Map([["IMG_1", "snap-mobile"]]),
    new Map([["IMG_1", PHONE_ELEMENTS]]),
    new Map([["IMG_1", "mobile"]]),
  ).findings;
  const hl = out[0]?.highlights?.[0];
  if (!hl) throw new Error("the cart is named and boxed, so this must pin");
  // The row runs from the search icon to the menu button, and the cart is inside it.
  if (hl.y > 5) throw new Error(`expected the header row, got y=${hl.y}`);
  if (hl.x > 47) throw new Error(`expected the row to start at the search icon, got x=${hl.x}`);
  if (hl.x + hl.w < 85) throw new Error(`expected the row to reach the menu, got right edge ${hl.x + hl.w}`);
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

// --- the cart that "says nothing about shipping" ---------------------------
//
// A live cart finding read "The cart total shows no mention of how shipping
// cost or speed will affect the price before checkout" while the line directly
// under the total read "Taxes and shipping calculated at checkout". The words
// were in the captured labels; the audit said they were not there.

const CART_ELEMENTS: ElementBox[] = [
  { id: "el_1", label: "div: Subtotal $14.99 USD", x: 5, y: 70, w: 90, h: 4 },
  { id: "el_2", label: "p: Taxes and shipping calculated at checkout", x: 5, y: 75, w: 90, h: 3 },
  { id: "el_3", label: "button: CHECKOUT $14.99", x: 5, y: 80, w: 90, h: 6 },
];

function cartFindings(text: string, recommendation: string) {
  return coercePageAudit(
    { intro: "x", findings: [{ text, recommendation, viewport: "mobile" }] },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", CART_ELEMENTS]]),
    new Map([["IMG_1", "mobile"]]),
    "cart",
  ).findings;
}

Deno.test("a cart finding claiming no shipping information is refused", () => {
  const kept = cartFindings(
    "The cart total shows no mention of how shipping cost or speed will affect the price before checkout.",
    "Add a short delivery estimate next to the total, such as 'Arrives in X business days'.",
  );
  if (kept.length !== 0) throw new Error("the claim of absence must be refused");
});

Deno.test("a finding that acknowledges the line and asks for more still stands", () => {
  // "It only says calculated at checkout, give them a real estimate" is a
  // different and fair point. Refusing it would cost a genuine finding.
  const kept = cartFindings(
    "The cart only says taxes and shipping are calculated at checkout, so the delivery cost is still unknown here.",
    "Show a live shipping estimate in the cart so the total is not a surprise at checkout.",
  );
  if (kept.length !== 1) throw new Error("an acknowledged-disclosure finding must survive");
});

Deno.test("the refusal does not fire on a cart without the disclosure", () => {
  const kept = coercePageAudit(
    {
      intro: "x",
      findings: [{
        text: "The cart says nothing about shipping cost before checkout.",
        recommendation: "Add a delivery estimate near the total.",
        viewport: "mobile",
      }],
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", [CART_ELEMENTS[0], CART_ELEMENTS[2]]]]),
    new Map([["IMG_1", "mobile"]]),
    "cart",
  ).findings;
  if (kept.length !== 1) throw new Error("with no disclosure on the page the claim is fair");
});

Deno.test("the refusal is scoped to the cart", () => {
  const kept = coercePageAudit(
    {
      intro: "x",
      findings: [{
        text: "The product page says nothing about shipping cost.",
        recommendation: "Add a delivery line under the buy button.",
        viewport: "mobile",
      }],
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", CART_ELEMENTS]]),
    new Map([["IMG_1", "mobile"]]),
    "product",
  ).findings;
  if (kept.length !== 1) throw new Error("a product page finding is not the cart's business");
});

// --- plays arriving as a string --------------------------------------------

Deno.test("plays JSON-encoded into a string are recovered", () => {
  // The whole "Opportunities in the data" block vanished from a live report
  // because this path used a bare Array.isArray while findings had already been
  // fixed. Same bug, one line away, missed.
  const real = [
    { title: "Raise the free shipping bar", insight: "The threshold sits below the median order.", action_steps: ["Move it to $150"], metric: "$100" },
    { title: "Lift the basket", insight: "Most orders carry one item.", action_steps: ["Add a bundle row"], metric: "64%" },
  ];
  const out = coerceAnalytics({ intro: "x", plays: JSON.stringify(real) });
  if (out.plays.length !== 2) throw new Error(`expected 2 plays, got ${out.plays.length}`);
  if (out.plays[0].title !== "Raise the free shipping bar") throw new Error("wrong play order");
});

Deno.test("a play's steps and products survive being sent as strings", () => {
  const out = coerceAnalytics({
    intro: "x",
    plays: [{
      title: "Pair the adapters",
      insight: "Bought together in 19 orders.",
      action_steps: '["Add Adapter Pins as an add-on","Bundle both at a discount"]',
      products: '["Adapter Pins","Auger Adapters"]',
      metric: "19 orders",
    }],
  });
  if (out.plays.length !== 1) throw new Error("the play should survive");
  if (out.plays[0].action_steps.length !== 2) throw new Error(`steps: ${JSON.stringify(out.plays[0].action_steps)}`);
  if (out.plays[0].products.length !== 2) throw new Error(`products: ${JSON.stringify(out.plays[0].products)}`);
});

// --- a list that arrived as tagged text ------------------------------------

Deno.test("an <item> tagged string is read as the list it is", () => {
  // A live retry sent pros as "\n<item>...</item>\n<item>...</item>". The items
  // were right there; throwing the reply away cost the whole retry.
  const out = coercePageAudit(
    {
      intro: "x",
      findings: [],
      pros: "\n<item>The cart shows a free shipping progress bar.</item>\n<item>Estimated delivery dates sit above checkout.</item>",
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "desktop"]]),
  );
  if (out.pros.length !== 2) throw new Error(`expected 2 pros, got ${JSON.stringify(out.pros)}`);
  if (out.pros[0] !== "The cart shows a free shipping progress bar.") throw new Error(`tags not stripped: ${out.pros[0]}`);
});

Deno.test("a stray tag on a plain line is stripped too", () => {
  const out = coercePageAudit(
    { intro: "x", findings: [], recommendations: "<p>Move the button up</p>\n<p>Add a delivery line</p>" },
    new Map([["IMG_1", "snap-1"]]),
    new Map(),
    new Map([["IMG_1", "desktop"]]),
  );
  if (out.recommendations.length !== 2) throw new Error(JSON.stringify(out.recommendations));
  if (out.recommendations[0] !== "Move the button up") throw new Error(out.recommendations[0]);
});

// --- a cart that already states its shipping -------------------------------
//
// This cart said "MOST ORDERS SHIP WITHIN ONE BUSINESS DAY" and "Estimated
// delivery between: Aug 24, 2026-Aug 26, 2026", and the audit still claimed the
// drawer never mentions how long shipping takes. Two lines on the page, both in
// the captured labels.

const PP_CART: ElementBox[] = [
  { id: "el_1", label: "p: FREE SHIPPING ON ORDERS ABOVE $100+", x: 5, y: 5, w: 90, h: 3 },
  { id: "el_2", label: "p: MOST ORDERS SHIP WITHIN ONE BUSINESS DAY", x: 5, y: 9, w: 90, h: 3 },
  { id: "el_3", label: "div: Estimated delivery between: Aug 24, 2026-Aug 26, 2026.", x: 5, y: 88, w: 90, h: 3 },
];

function ppCart(text: string, recommendation = "Add a delivery line.") {
  return coercePageAudit(
    { intro: "x", findings: [{ text, recommendation, viewport: "both" }] },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", PP_CART]]),
    new Map([["IMG_1", "mobile"]]),
    "cart",
  ).findings;
}

Deno.test("a delivery estimate on the page refuses a claim that it is missing", () => {
  const kept = ppCart("The cart drawer never mentions how long shipping takes or what returns look like.");
  if (kept.length !== 0) throw new Error("the claim is contradicted by two lines on the page");
});

Deno.test("a dispatch time on the page counts as stating it", () => {
  const kept = coercePageAudit(
    {
      intro: "x",
      findings: [{ text: "There is no shipping information anywhere in the cart.", recommendation: "Add some.", viewport: "both" }],
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", [PP_CART[1]]]]),
    new Map([["IMG_1", "mobile"]]),
    "cart",
  ).findings;
  if (kept.length !== 0) throw new Error("'ships within one business day' is shipping information");
});

Deno.test("a finding about WHERE the delivery estimate sits still stands", () => {
  // The real point on this cart: the estimate is below the checkout button, so
  // it arrives after the decision. That is a placement finding, not absence.
  const kept = ppCart(
    "The estimated delivery date is the last thing shoppers see, after the green checkout button.",
    "Move the estimated delivery line above the checkout button.",
  );
  if (kept.length !== 1) throw new Error("a placement finding must survive");
});

Deno.test("asking for more than the store already says still stands", () => {
  const kept = ppCart(
    "The cart says orders ship within one business day but never says how long delivery takes after dispatch.",
    "Add a delivery window next to the dispatch promise.",
  );
  if (kept.length !== 1) throw new Error("an acknowledged-and-extended finding must survive");
});

Deno.test("a cart with no shipping copy keeps the absence finding", () => {
  const kept = coercePageAudit(
    {
      intro: "x",
      findings: [{ text: "The cart never mentions shipping cost or timing.", recommendation: "Add a line.", viewport: "both" }],
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", [{ id: "el_1", label: "button: CHECKOUT", x: 5, y: 90, w: 90, h: 6 }]]]),
    new Map([["IMG_1", "mobile"]]),
    "cart",
  ).findings;
  if (kept.length !== 1) throw new Error("with nothing on the page the claim is fair");
});

Deno.test("cart roominess is refused in every wording the model has found", () => {
  // Each of these is the same artifact: the cart holds the single item we added
  // in order to photograph it. The pattern used to require the word "empty"
  // first, so "a lot of open white space" shipped in a live report.
  for (const text of [
    "The desktop cart drawer leaves a lot of open white space below the suggested products.",
    "There is a large empty space under the cart items.",
    "The cart has excess space between the total and the button.",
    "A lot of unused space sits below the upsell row.",
    "The layout feels sparse with only one item.",
    "The cart looks bare on desktop.",
  ]) {
    const kept = coercePageAudit(
      { intro: "x", findings: [{ text, recommendation: "Tighten the layout.", viewport: "desktop" }] },
      new Map([["IMG_1", "snap-1"]]),
      new Map([["IMG_1", PP_CART]]),
      new Map([["IMG_1", "desktop"]]),
      "cart",
    ).findings;
    if (kept.length !== 0) throw new Error(`should be refused on the cart: ${text}`);
  }
});

Deno.test("the same wording is still allowed away from the cart", () => {
  const kept = coercePageAudit(
    {
      intro: "x",
      findings: [{
        text: "The collection grid leaves a lot of open white space between rows.",
        recommendation: "Tighten the grid.",
        viewport: "desktop",
      }],
    },
    new Map([["IMG_1", "snap-1"]]),
    new Map([["IMG_1", PP_CART]]),
    new Map([["IMG_1", "desktop"]]),
    "collection",
  ).findings;
  if (kept.length !== 1) throw new Error("only the cart's roominess is our artifact");
});

// --- advice that guesses at the store's setup ------------------------------
//
// A play told a client to "Turn on Shopify's abandoned checkout emails" and to
// "Simplify checkout to one page if your current theme still splits it into
// multiple steps". This audit never opens the checkout, never reads the
// notification settings and never inspects the theme, so both were guesses
// written as instructions.

Deno.test("switching on a setting we never read is refused", () => {
  for (const step of [
    "Turn on Shopify's abandoned checkout emails with a reminder sent within an hour.",
    "Enable express checkout so returning payment details autofill.",
    "Switch on the free shipping progress bar in the cart drawer.",
    "Activate Shop Pay for faster repeat purchases.",
  ]) {
    if (!presumesSetup(step)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("a step that hedges about its own premise is refused", () => {
  for (const step of [
    "Simplify checkout to one page if your current theme still splits it into multiple steps.",
    "Add a review widget if you have not already installed one.",
    "Raise the threshold if it is not already above the median.",
    "Assuming you are not already doing this, add a delivery estimate.",
  ]) {
    if (!presumesSetup(step)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("changing the checkout page itself is refused", () => {
  // We never capture it, so nothing about its layout can be evidenced.
  for (const step of [
    "Move to a one-page checkout.",
    "Reduce the multi-step checkout to a single screen.",
    "Trim the checkout form fields to name, email and address.",
  ]) {
    if (!presumesSetup(step)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("new work and page changes we did see are untouched", () => {
  for (const step of [
    "Add a visible returns and delivery-time line next to the buy button on product pages.",
    "Send a follow-up email 30 days after purchase offering a discount on the Garden Answer 7 inch Auger.",
    "Set a free shipping bar at $225, just above the current $216.23 average.",
    "Add Adapter Pins as a suggested add-on on the Auger Adapters product page and in cart.",
    "Show a progress message in cart like 'Add $9 more for free shipping'.",
    "Give every item in the upsell row its own add button.",
  ]) {
    if (presumesSetup(step)) throw new Error(`should be kept: ${step}`);
    if (isBannedWork(step)) throw new Error(`should be kept: ${step}`);
    if (isDiagnosticStep(step)) throw new Error(`should be kept: ${step}`);
  }
});

Deno.test("a play keeps the steps that survive and loses the guesses", () => {
  const out = coerceAnalytics({
    intro: "x",
    plays: [{
      title: "Fix the checkout drop-off",
      insight: "49% of shoppers who reach checkout do not complete the purchase.",
      action_steps: [
        "Add a visible returns and delivery-time line next to the buy button on product pages.",
        "Turn on Shopify's abandoned checkout emails with a reminder sent within an hour.",
        "Simplify checkout to one page if your current theme still splits it into multiple steps.",
      ],
      metric: "49%",
    }],
  });
  if (out.plays.length !== 1) throw new Error("the play should survive on its one good step");
  if (out.plays[0].action_steps.length !== 1) throw new Error(`steps: ${JSON.stringify(out.plays[0].action_steps)}`);
  if (!out.plays[0].action_steps[0].includes("returns and delivery-time")) throw new Error("kept the wrong step");
});

// --- a pin for a finding about a GROUP of elements -------------------------
//
// "The phone header bunches search, account and cart all on the right" was
// pinned a row too low, over the growing-zone bar under the icons. No single
// element matched: every word in it is generic on its own, so label matching
// refused them all and the pin fell back to the model's guessed box.
//
// These are the real element boxes from that capture.
const LAZYLEAF_MOBILE: ElementBox[] = [
  { id: 'el_1', label: 'a: FREE SHIPPING ON US ORDERS $100+', x: 13.53, y: 1.54, w: 72.93, h: 2.13 },
  { id: 'el_2', label: 'header', x: 0, y: 5.33, w: 100, h: 5.69 },
  { id: 'el_3', label: 'a: search', x: 50.26, y: 5.8, w: 11.28, h: 4.74 },
  { id: 'el_4', label: 'a: Log in', x: 61.54, y: 5.8, w: 11.28, h: 4.74 },
  { id: 'el_5', label: 'a: icon-cart', x: 72.82, y: 5.8, w: 11.28, h: 4.74 },
  { id: 'el_6', label: 'h1', x: 5.13, y: 6.63, w: 43.08, h: 3.08 },
  { id: 'el_7', label: 'img: Shop LazyLeaf', x: 5.13, y: 6.63, w: 25.64, h: 3.08 },
  { id: 'el_8', label: 'span: Planting in: n/a Growing Zone: n/a', x: 12.31, y: 12.3, w: 82.56, h: 1.93 },
  { id: 'el_10', label: 'span: Growing Zone: n/a', x: 65.19, y: 12.3, w: 29.68, h: 1.93 },
  { id: 'el_11', label: 'section: Because Lazy Grows Better Plants', x: 0, y: 15.52, w: 100, h: 54.57 },
];

const BUNCHED = 'The phone header bunches search, account and cart all on the right with the menu icon, leaving the left side empty.';

Deno.test("a finding about a group of icons pins the group, not the model's guess", () => {
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: BUNCHED,
        recommendation: 'Rebalance the icons so the menu sits on the left.',
        viewport: 'mobile',
        // The box the model actually sent: a row too low, over the growing-zone bar.
        highlights: [{ image_ref: 'IMG_1', label: 'Header icon cluster', x: 54, y: 10, w: 44, h: 8 }],
      }],
    },
    new Map([['IMG_1', 'snap-mobile']]),
    new Map([['IMG_1', LAZYLEAF_MOBILE]]),
    new Map([['IMG_1', 'mobile']]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('the finding should still be pinned');
  // The icons run 5.8 to 10.54 down the shot; the growing-zone bar is at 12.3.
  if (pin.y > 7) throw new Error(`pin should sit on the icon row, got y=${pin.y}`);
  if (pin.y + pin.h > 12) throw new Error(`pin should end above the growing-zone bar, got ${pin.y + pin.h}`);
  if (pin.x > 52) throw new Error(`pin should start at the search icon, got x=${pin.x}`);
});

Deno.test("one generic word shared with one element is still not a pin", () => {
  // The bar the group rule has to clear: "the cart is hard to find" names one
  // generic thing, and guessing which element that is was never safe.
  const group = snapToElementGroup('The cart is hard to find on a phone.', LAZYLEAF_MOBILE);
  if (group) throw new Error('one element matching one word must not make a group');
});

Deno.test("a group box that covers the screen is refused", () => {
  // Once the box is the whole page it points at nothing, so the model's own
  // guess is no worse and the rule stands aside.
  const wide: ElementBox[] = [
    { id: 'el_1', label: 'a: search', x: 2, y: 4, w: 10, h: 4 },
    { id: 'el_2', label: 'div: cart total', x: 5, y: 80, w: 90, h: 15 },
  ];
  if (snapToElementGroup('search and cart are far apart', wide)) {
    throw new Error('a full-page box is not a pin');
  }
});

Deno.test("a single element still wins when it genuinely matches", () => {
  // Group snapping is a last resort: a precise single match is better, and this
  // finding names one distinctive thing.
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: 'The FREE SHIPPING ON US ORDERS $100+ bar is easy to miss.',
        recommendation: 'Make it bolder.',
        viewport: 'mobile',
        highlights: [{ image_ref: 'IMG_1', label: 'Announcement bar', x: 0, y: 50, w: 100, h: 5 }],
      }],
    },
    new Map([['IMG_1', 'snap-mobile']]),
    new Map([['IMG_1', LAZYLEAF_MOBILE]]),
    new Map([['IMG_1', 'mobile']]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('should be pinned');
  if (Math.round(pin.y) !== 2) throw new Error(`should snap to the announcement bar at y=1.54, got ${pin.y}`);
});

Deno.test("the group beats one word matched inside the same sentence", () => {
  // The ordering this depends on: the sentence contains "cart", so matching one
  // word would pin the cart icon alone. The sentence is about three icons.
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: BUNCHED,
        recommendation: 'Rebalance the icons.',
        viewport: 'mobile',
        highlights: [{ image_ref: 'IMG_1', label: 'Search, account, cart, menu cluster', x: 54, y: 10, w: 44, h: 8 }],
      }],
    },
    new Map([['IMG_1', 'snap-mobile']]),
    new Map([['IMG_1', LAZYLEAF_MOBILE]]),
    new Map([['IMG_1', 'mobile']]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('should be pinned');
  // The cluster starts at the search icon (50.26) and ends past the cart (84.1),
  // rather than being the 11pt-wide cart icon at 72.82.
  if (Math.round(pin.x) !== 50) throw new Error(`expected the cluster to start at the search icon, got x=${pin.x}`);
  if (pin.w < 30) throw new Error(`expected a cluster-width box, got w=${pin.w}`);
  if (Math.round(pin.y) !== 6) throw new Error(`expected the icon row, got y=${pin.y}`);
});

// --- a cart that already carries its own reassurance -----------------------
//
// "The cart drawer never mentions returns or a guarantee near checkout" on a
// cart offering Order Protection against damage, loss and theft, under a button
// reading Protected Checkout. The words were in the captured labels.

const PP_CART_TRUST: ElementBox[] = [
  { id: 'el_1', label: 'div: Order Protection Protect from damage, loss and theft. $2.99', x: 5, y: 70, w: 90, h: 4 },
  { id: 'el_2', label: 'div: Estimated delivery between: Aug 24, 2026-Aug 26, 2026.', x: 5, y: 88, w: 90, h: 3 },
  { id: 'el_3', label: 'button: PROTECTED CHECKOUT $23.49', x: 5, y: 92, w: 90, h: 6 },
];

function trustCart(text: string, recommendation = 'Add a returns line.') {
  return coercePageAudit(
    { intro: 'x', findings: [{ text, recommendation, viewport: 'both' }] },
    new Map([['IMG_1', 'snap-1']]),
    new Map([['IMG_1', PP_CART_TRUST]]),
    new Map([['IMG_1', 'mobile']]),
    'cart',
  ).findings;
}

Deno.test("a claim of no guarantee is refused when the cart shows protection", () => {
  const kept = trustCart('The cart drawer never mentions returns or a guarantee near checkout, only shipping and delivery dates.');
  if (kept.length !== 0) throw new Error('the cart offers Order Protection under a Protected Checkout button');
});

Deno.test("a finding that names the protection and asks for more still stands", () => {
  // "Order Protection is offered with only a vague question mark" is a fair
  // point about the thing that IS there, and it must survive.
  const kept = trustCart(
    'Order Protection is offered with only a vague question mark for explanation, right next to the button that closes the sale.',
    'Swap the question mark for a one-line tooltip stating what is covered.',
  );
  if (kept.length !== 1) throw new Error('a finding about the existing protection must survive');
});

Deno.test("a cart carrying no reassurance keeps the claim", () => {
  const kept = coercePageAudit(
    {
      intro: 'x',
      findings: [{ text: 'The cart offers no guarantee or returns reassurance at all.', recommendation: 'Add one.', viewport: 'both' }],
    },
    new Map([['IMG_1', 'snap-1']]),
    new Map([['IMG_1', [{ id: 'el_1', label: 'button: CHECKOUT', x: 5, y: 92, w: 90, h: 6 }]]]),
    new Map([['IMG_1', 'mobile']]),
    'cart',
  ).findings;
  if (kept.length !== 1) throw new Error('with nothing on the page the claim is fair');
});

// --- one shared word against a one-word element ---------------------------

Deno.test("a pin labelled for the hero does not land on a nav item called BULBS", () => {
  const els: ElementBox[] = [
    { id: 'el_15', label: 'nav: AUGERS AUGER ACCESSORIES BUNDLES TOOLS BULBS', x: 0, y: 20.94, w: 100, h: 7.33 },
    { id: 'el_20', label: 'a: BULBS', x: 50, y: 20.94, w: 12.5, h: 7.11 },
    { id: 'el_27', label: 'section: Previous 1 Next Page 1 of 2', x: 0, y: 28.27, w: 100, h: 55.56 },
  ];
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: 'The hero banner is entirely a fall bulbs sale, so a first-time visitor cannot tell that augers and planting tools are the core business.',
        recommendation: 'Swap in a hero image showing an auger at work.',
        viewport: 'desktop',
        highlights: [{ image_ref: 'IMG_1', label: 'Hero banner: 25% Off Fall Bulbs', x: 4, y: 30, w: 92, h: 40 }],
      }],
    },
    new Map([['IMG_1', 'snap-desktop']]),
    new Map([['IMG_1', els]]),
    new Map([['IMG_1', 'desktop']]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('should still be pinned');
  // The nav sits at y=20.94 and is 7.33 tall; the hero starts below it.
  if (pin.y < 28) throw new Error(`pin landed in the nav strip at y=${pin.y}`);
  if (Math.round(pin.w) === 13) throw new Error('pin snapped to the one-word BULBS nav item');
});

Deno.test("a short pin label still wins a one-word element on one distinctive word", () => {
  // The bar the rule must not cross. "Bulbs menu" is essentially about the one
  // word it shares, so snapping to the BULBS item is right; the hero pin above
  // said four other things as well, which is what made it wrong.
  const els: ElementBox[] = [
    { id: 'el_20', label: 'a: BULBS', x: 50, y: 20.94, w: 12.5, h: 7.11 },
    { id: 'el_27', label: 'section: Previous 1 Next Page 1 of 2', x: 0, y: 28.27, w: 100, h: 55.56 },
  ];
  const pin = snapToElementByLabel('Bulbs menu', els);
  if (!pin || pin.id !== 'el_20') throw new Error(`expected the BULBS item, got ${JSON.stringify(pin)}`);
  // And the long form is refused, which is the whole point of the change.
  if (snapToElementByLabel('Hero banner: 25% Off Fall Bulbs', els)) {
    throw new Error('a five-word label must not win a one-word element');
  }
});

// --- a finding about the hero, which the DOM cannot describe ---------------
//
// A homepage hero is one big photograph with its words baked into the pixels, so
// no element carries "25% OFF FALL BULBS". Every matching route failed and the
// pin fell back to the model's guess, which put the hero at y=88, near the
// bottom of a page whose hero starts at 28.

const PP_HOME: ElementBox[] = [
  { id: 'el_15', label: 'nav: AUGERS AUGER ACCESSORIES BUNDLES TOOLS BULBS', x: 0, y: 20.94, w: 100, h: 7.33 },
  { id: 'el_20', label: 'button: BULBS', x: 50, y: 20.94, w: 12.5, h: 7.11 },
  { id: 'el_31', label: 'h1: Get Started With Our Best Selling Augers', x: 2.5, y: 87.16, w: 95, h: 7.22 },
];
// The capture's own photo inventory: the hero, and a small logo.
const PP_PHOTOS = [
  { x: 0, y: 28.27, w: 100, h: 55.56 },
  { x: 44, y: 8, w: 12, h: 4 },
];

Deno.test("a hero finding anchors to the hero photograph", () => {
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: 'The homepage sells a 25% off bulb promotion, not the augers and tools the store is actually for.',
        recommendation: 'Lead with an auger at work.',
        viewport: 'desktop',
        highlights: [{ image_ref: 'IMG_1', label: '25% Off Fall Bulbs hero', x: 0, y: 88, w: 100, h: 10 }],
      }],
    },
    new Map([['IMG_1', 'snap-desktop']]),
    new Map([['IMG_1', PP_HOME]]),
    new Map([['IMG_1', 'desktop']]),
    'homepage',
    new Map([['IMG_1', PP_PHOTOS]]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('should be pinned');
  if (Math.round(pin.y) !== 28) throw new Error(`expected the hero photo at y=28.27, got ${pin.y}`);
  if (Math.round(pin.h) !== 56) throw new Error(`expected the hero's height, got ${pin.h}`);
});

Deno.test("the hero anchor only fires for a finding about the hero", () => {
  // A finding about the nav must not be dragged onto the hero photograph.
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: 'The desktop navigation packs eight categories edge to edge with no breathing room.',
        recommendation: 'Group them.',
        viewport: 'desktop',
        highlights: [{ image_ref: 'IMG_1', label: 'Category navigation row', x: 0, y: 21, w: 100, h: 7 }],
      }],
    },
    new Map([['IMG_1', 'snap-desktop']]),
    new Map([['IMG_1', PP_HOME]]),
    new Map([['IMG_1', 'desktop']]),
    'homepage',
    new Map([['IMG_1', PP_PHOTOS]]),
  ).findings;
  const pin = out[0]?.highlights?.[0];
  if (!pin) throw new Error('should be pinned');
  if (Math.round(pin.y) === 28) throw new Error('a nav finding must not snap to the hero photo');
});

Deno.test("with no photo inventory the hero anchor stands aside", () => {
  const out = coercePageAudit(
    {
      intro: 'x',
      findings: [{
        text: 'The hero banner is entirely a bulbs sale.',
        recommendation: 'Change it.',
        viewport: 'desktop',
        highlights: [{ image_ref: 'IMG_1', label: 'Hero banner', x: 5, y: 30, w: 90, h: 40 }],
      }],
    },
    new Map([['IMG_1', 'snap-desktop']]),
    new Map([['IMG_1', PP_HOME]]),
    new Map([['IMG_1', 'desktop']]),
    'homepage',
  ).findings;
  const pin = out[0]?.highlights?.[0];
  // Falls back to the model's own box rather than losing the pin.
  if (!pin || Math.round(pin.y) !== 30) throw new Error(`expected the model's box, got ${JSON.stringify(pin)}`);
});

Deno.test("a small photo is never mistaken for the hero", () => {
  // A logo or a badge in the header is a photograph too.
  const onlySmall = [{ x: 44, y: 8, w: 12, h: 4 }];
  if (snapToHeroPhoto('Hero banner', onlySmall)) throw new Error('a 12x4 logo is not a hero');
});

// --- dispatch-time shipping disclosures ------------------------------------

function dispatchCart(labels: string[], text: string) {
  const els: ElementBox[] = labels.map((label, i) => ({ id: 'el_' + (i + 1), label, x: 5, y: 40 + i * 10, w: 90, h: 6 }));
  return coercePageAudit(
    { intro: 'x', findings: [{ text, recommendation: 'Say when it ships.', viewport: 'both' }] },
    new Map([['IMG_1', 'snap-1']]),
    new Map([['IMG_1', els]]),
    new Map([['IMG_1', 'mobile']]),
    'cart',
  ).findings;
}

Deno.test("a dispatch time like 'Ships in 2 days' counts as a shipping disclosure", () => {
  // This alternate shipped with an eaten backslash (\d became d), so it never
  // matched and the false "cart says nothing about shipping" claim survived.
  const kept = dispatchCart(
    ['div: Ships in 2 days', 'button: CHECKOUT'],
    'The cart never tells shoppers anything about shipping or when their order will arrive.',
  );
  if (kept.length !== 0) throw new Error("'Ships in 2 days' is on the page, so the claim of silence must be refused");
});

Deno.test("a day-count range like '3-5 business days' counts as a disclosure too", () => {
  const kept = dispatchCart(
    ['div: Delivery in 3-5 business days', 'button: CHECKOUT'],
    'Nothing in the cart mentions shipping times, which leaves shoppers guessing.',
  );
  if (kept.length !== 0) throw new Error("'3-5 business days' is on the page, so the claim of silence must be refused");
});

// --- proving a photographed cart was populated -------------------------------
//
// The cart section hides unless the capture can show the cart had something in
// it. Power Planter serves the drawer but blocks the /cart.js fetch that records
// the item count, so a flawless slide-cart shot (one item, "CHECKOUT $23.49" on
// the button) was hidden for want of a number.

Deno.test("a checkout button carrying an amount proves a populated cart", () => {
  const rows = [{
    elements: [
      { id: 'el_1', label: 'p: Shopping Cart', x: 66, y: 2, w: 30, h: 4 },
      { id: 'el_2', label: 'a: CHECKOUT $23.49', x: 66, y: 90, w: 30, h: 6 },
    ] as ElementBox[],
  }];
  if (!cartLooksPopulated(rows)) throw new Error('CHECKOUT $23.49 is proof the cart had an item');
});

Deno.test("a homepage header is not mistaken for a populated cart", () => {
  // The free-shipping bar carries a dollar amount and the header carries the
  // word Cart, and neither means the cart has anything in it.
  const rows = [{
    elements: [
      { id: 'el_1', label: 'div: FREE SHIPPING ON ALL DOMESTIC US ORDERS ABOVE $100+', x: 0, y: 0, w: 100, h: 4 },
      { id: 'el_2', label: 'nav: Call Us Write Us Account Cart', x: 60, y: 5, w: 40, h: 5 },
    ] as ElementBox[],
  }];
  if (cartLooksPopulated(rows)) throw new Error('a header and a shipping bar are not a cart');
});

Deno.test("the tax disclosure alone does not count as a populated cart", () => {
  // "calculated at checkout" contains the word but names no amount.
  const rows = [{
    elements: [
      { id: 'el_1', label: 'div: Taxes and shipping calculated at checkout', x: 5, y: 80, w: 90, h: 4 },
    ] as ElementBox[],
  }];
  if (cartLooksPopulated(rows)) throw new Error('a disclosure is not evidence of contents');
});

Deno.test("a subtotal with an amount also proves it", () => {
  const rows = [{
    elements: [{ id: 'el_1', label: 'div: Subtotal $84.00', x: 5, y: 70, w: 90, h: 4 }] as ElementBox[],
  }];
  if (!cartLooksPopulated(rows)) throw new Error('a subtotal with money is a populated cart');
});

// --- plays that recommend what the store already has --------------------------
//
// A play told a client to "Add a sticky add-to-cart bar on phone product pages".
// The capture had measured that page and could have answered, but the data
// section never received page evidence, so it was guessing. It happened to be
// right; on a store with a sticky bar it would have told them to build one.

Deno.test("a step adding a sticky bar is refused when the page has one", () => {
  const present = new Set(['sticky_buy_button']);
  const step = 'Add a sticky add-to-cart bar on phone product pages so the button stays reachable while scrolling.';
  if (!recommendsExistingFeature(step, present)) throw new Error('should be refused: the page already has one');
});

Deno.test("the same step stands when the page does not have one", () => {
  // Power Planter measured sticky_buy_button: found false, so this advice is
  // real and must survive.
  const present = new Set(['reviews', 'recommendations']);
  const step = 'Add a sticky add-to-cart bar on phone product pages so the button stays reachable while scrolling.';
  if (recommendsExistingFeature(step, present)) throw new Error('a genuinely missing feature must still be recommendable');
});

Deno.test("with nothing measured, nothing is refused on these grounds", () => {
  const step = 'Add customer reviews to the product page.';
  if (recommendsExistingFeature(step, undefined)) throw new Error('no measurements means no verdict');
  if (recommendsExistingFeature(step, new Set())) throw new Error('no measurements means no verdict');
});

Deno.test("changing an existing feature is not the same as adding one", () => {
  // Asking to move or restyle what is there is fair; only "build this" is not.
  const present = new Set(['sticky_buy_button']);
  const step = 'Move the sticky add-to-cart bar above the fold so it clears the promo banner.';
  if (recommendsExistingFeature(step, present)) throw new Error('rewording an existing element is legitimate');
});

Deno.test("coerceAnalytics drops the offending step but keeps the play", () => {
  const parsed = coerceAnalytics({
    intro: 'x',
    plays: [{
      title: 'Win back mobile shoppers',
      insight: 'Mobile carries 58% of sessions but converts at 0.48%.',
      action_steps: [
        'Add a sticky add-to-cart bar on phone product pages so the button stays reachable.',
        'Test larger, single-column product images on mobile.',
      ],
      metric: '0.48% mobile conversion rate',
    }],
  }, new Set(['sticky_buy_button']));
  const steps = parsed.plays[0]?.action_steps ?? [];
  if (steps.length !== 1) throw new Error(`expected the sticky step dropped, got ${JSON.stringify(steps)}`);
  if (!steps[0].includes('single-column')) throw new Error('the good step must survive');
});

Deno.test("a cross-sell block is caught whatever the theme calls it", () => {
  // "you may also NEED" reached a live report on a product page the probe had
  // already found a recommendations block on. The block is the fact; the
  // wording above it is not.
  const present = new Set(['recommendations']);
  for (const step of [
    'Add a you may also need section on the DEWALT DCD130T1 product page pointing to the Auger.',
    'Add a you may also like row to the product page.',
    'Build a complete the look section under the buy button.',
    'Introduce related products on the product page.',
  ]) {
    if (!recommendsExistingFeature(step, present)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("naming a specific product to merchandise is not adding a block", () => {
  // Configuring what appears in a row that exists is the useful version of this
  // advice, and it must survive.
  const present = new Set(['recommendations']);
  const step = 'Add Adapter Pins as a one-click add-on directly on the Auger Adapters product page.';
  if (recommendsExistingFeature(step, present)) throw new Error('merchandising an existing surface is legitimate');
});

// --- six live play steps a strategist rejected --------------------------------
//
// Each string below is verbatim from a shipped report. They share one cause:
// the data section writes from order and traffic figures and was inventing
// specifics about pages it had never seen.

Deno.test("button copy rewrites are refused outright", () => {
  // Both stores' buttons already read ADD TO CART, so "replace the generic
  // label" asked for what was there. Per-product button copy is also a theme
  // change out of proportion to anything it wins.
  for (const step of [
    'Test a specific button label like Add to cart in place of a generic one on those same pages.',
    "Rewrite product buttons to name the benefit, like 'Add Umbrella to Cart' instead of a generic label.",
  ]) {
    if (!isBannedWork(step)) throw new Error(`should be banned: ${step}`);
  }
});

Deno.test("a button step that is not about its wording still stands", () => {
  for (const step of [
    'Put a plain shipping and returns line right beside the add-to-cart button.',
    'Add a comparison note near the buy button showing why this auger size fits the job.',
  ]) {
    if (isBannedWork(step)) throw new Error(`must survive: ${step}`);
  }
});

Deno.test("checkout shape changes are refused, since we never open the checkout", () => {
  const step = 'Test a simplified two-step checkout flow with fewer form fields before the pay button.';
  if (!presumesSetup(step)) throw new Error('the checkout is never captured, so this cannot be evidenced');
});

Deno.test("rearranging a page this section never saw is refused", () => {
  const step = 'Shrink the checkout steps visible on phones by moving secondary info like specs below the buy button.';
  if (!assumesLayout(step)) throw new Error('this asserts where the specs currently sit');
});

Deno.test("deciding what to merchandise is not rearranging", () => {
  for (const step of [
    'Feature your top revenue products in the first row shoppers reach on mobile.',
    'Add a star rating and short review quote next to the price on your top revenue products.',
  ]) {
    if (assumesLayout(step)) throw new Error(`must survive: ${step}`);
  }
});

Deno.test("shipping protection is not recommended to a cart that offers it", () => {
  const present = new Set(['cart_shipping_protection']);
  const step = "Pair Shipping Protection with high-ticket items like the 8' Heavy Duty Umbrella at checkout-adjacent placement.";
  if (!recommendsExistingFeature(step, present)) throw new Error('the cart already offers it on the whole order');
  if (recommendsExistingFeature(step, new Set())) throw new Error('a cart without it may still be advised');
});

Deno.test("cart add-ons are not recommended to a drawer that has them", () => {
  const present = new Set(['cart_recommendations']);
  for (const step of [
    'Add the bundle as a suggested add-on in the cart drawer.',
    'Repeat the same add-on placement in the cart drawer for anyone who has Auger Adapters in their basket.',
  ]) {
    if (!recommendsExistingFeature(step, present)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("pre-checking protection is refused on a cart that already defaults to it", () => {
  const present = new Set(['cart_shipping_protection']);
  for (const step of [
    'Pre-check the Shipping Protection add-on by default on product pages for the CARY INSPIRED Welding Cap.',
    'Offer Shipping Protection pre-checked at the top of the cart.',
  ]) {
    if (!recommendsExistingFeature(step, present)) throw new Error(`should be refused: ${step}`);
  }
});

Deno.test("express wallet buttons are refused, since the checkout is never captured", () => {
  const step = 'Add express payment buttons like Shop Pay and Apple Pay right at the top of the mobile checkout.';
  if (!presumesSetup(step)) throw new Error('wallet buttons live on a surface this audit cannot see');
});

Deno.test("a play whose title recommends an existing feature is dropped whole", () => {
  const parsed = coerceAnalytics({
    intro: 'x',
    plays: [
      {
        title: 'Bundle Shipping Protection into top pairings',
        insight: 'High ticket items carry more delivery risk.',
        action_steps: ['Add a one-line note next to the add-on explaining what it covers.'],
        metric: 'x',
      },
      {
        title: 'Lift the single-item basket',
        insight: '70% of orders hold one item.',
        action_steps: ['Pair the 3 inch auger with the 7 inch auger on both product pages.'],
        metric: 'y',
      },
    ],
  }, new Set(['cart_shipping_protection']));
  const titles = parsed.plays.map((p) => p.title);
  if (titles.includes('Bundle Shipping Protection into top pairings')) {
    throw new Error('the protection play should be gone entirely, not just tidied');
  }
  if (!titles.includes('Lift the single-item basket')) throw new Error('the good play must survive');
});
