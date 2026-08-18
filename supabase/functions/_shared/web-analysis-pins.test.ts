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
