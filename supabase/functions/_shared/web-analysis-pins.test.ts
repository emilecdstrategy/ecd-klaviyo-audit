// Pin placement regressions. Run with: npx deno test supabase/functions/_shared/
//
// Every case here is a pin that once landed on the wrong thing in a report a
// client read. A wrong pin is worse than no pin, because it is a claim about
// where the problem is and the reader checks it against the screenshot.
import { coercePageAudit, type ElementBox } from "./web-analysis-schemas.ts";

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
