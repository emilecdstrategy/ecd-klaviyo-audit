import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BELOW_FOLD_PROBE, belowFoldEvidence, composeProbes, isBelowFoldReport, popupEvidence } from "./below-fold-probe.ts";
import { DOM_OUTLINE_PROBE } from "./html-after.ts";

// The probe runs as an async function body inside the page, so a syntax error in
// it is invisible to every check this repo runs: deno never parses it, and the
// capture swallows a throwing probe as "no outline". These tests are the only
// place a broken probe gets caught before a real audit quietly loses evidence.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

Deno.test("the below-fold probe body parses as an async function", () => {
  new AsyncFunction(BELOW_FOLD_PROBE);
});

Deno.test("the composed probe body parses, and keeps both probes", () => {
  const composed = composeProbes(DOM_OUTLINE_PROBE, BELOW_FOLD_PROBE);
  new AsyncFunction(composed);
  assertStringIncludes(composed, "below_fold");
});

Deno.test("a failing probe cannot take the other one down", () => {
  // Each half is wrapped separately on purpose: the outline feeds the after-image
  // engine and the below-fold report feeds the audit, and one throwing must not
  // cost the other.
  const composed = composeProbes("throw new Error('outline broke');", "return { page: { scroll_height: 4000 } };");
  const fn = new AsyncFunction(composed);
  const out = fn() as Promise<{ error?: string; below_fold?: { page?: { scroll_height?: number } } }>;
  return out.then((r) => {
    assert(r.error?.includes("outline broke"), `expected the outline error, got ${JSON.stringify(r)}`);
    assert(r.below_fold?.page?.scroll_height === 4000, "the below-fold half should still have run");
  });
});

const REPORT = {
  page: { scroll_height: 9000, viewport_height: 900, folds: 10 },
  headings: [
    { level: 2, text: "The details", y: 1200 },
    { level: 2, text: "Frequently asked questions", y: 4200 },
  ],
  features: {
    reviews: { found: false },
    recommendations: { found: true, note: '[class*="recommend" i]', y: 2400 },
    faq: { found: true, note: "details" },
  },
  footer: { found: true, links: 24, has_contact: true, has_social: false, has_policies: true },
  words: 830,
  images: 12,
};

Deno.test("isBelowFoldReport rejects a probe that errored", () => {
  assert(isBelowFoldReport(REPORT));
  assert(!isBelowFoldReport({ error: "probe threw" }));
  assert(!isBelowFoldReport(null));
  assert(!isBelowFoldReport({ page: {} }));
});

Deno.test("the evidence names what is present and what is absent", () => {
  const text = belowFoldEvidence([{ ref: "IMG_1", report: REPORT }]);
  assertStringIncludes(text, "IMG_1:");
  assertStringIncludes(text, "10 screens tall");
  assertStringIncludes(text, "product recommendations or cross-sells");
  assertStringIncludes(text, "NOT found anywhere below the fold: customer reviews");
  assertStringIncludes(text, '"Frequently asked questions"');
  assertStringIncludes(text, "24 links");
  assertStringIncludes(text, "830 words and 12 images");
});

Deno.test("the evidence forbids describing how a below-fold section looks", () => {
  // No screenshot of it was taken, so a claim about its appearance would be
  // invented. This is the same failure the hover evidence was added to stop.
  const text = belowFoldEvidence([{ ref: "IMG_1", report: REPORT }]);
  assertStringIncludes(text, "never recommend adding it");
  assertStringIncludes(text, "Never describe how a below-the-fold section LOOKS");
});

Deno.test("with no usable report the model is told to say nothing", () => {
  const text = belowFoldEvidence([{ ref: "IMG_1", report: { error: "probe threw" } }]);
  assertStringIncludes(text, "make NO claim");
  assert(!text.includes("NOT found"), "absence must not be implied when nothing was measured");
});

Deno.test("a section that rendered nothing is not passed off as present", () => {
  // A recommendations block with nothing configured is a container with no
  // content. Reporting it as simply "present" would bury a real finding.
  const text = belowFoldEvidence([{
    ref: "IMG_1",
    report: {
      ...REPORT,
      features: { recommendations: { found: true, note: "[class*=recommend]", empty: true } },
    },
  }]);
  assertStringIncludes(text, "may not be configured");
});

Deno.test("the probe rejects a class hook that only looks like a match", () => {
  // [class*="review"] also matches "preview-img", which reported a skeleton
  // placeholder as a review widget on a store that has none.
  const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  const body = BELOW_FOLD_PROBE.slice(
    BELOW_FOLD_PROBE.indexOf("function hasToken"),
    BELOW_FOLD_PROBE.indexOf("function pick"),
  ) + "return hasToken({ className: 'w-full preview-img aspect-natural', id: '' }, /^(reviews?)/) === false" +
    " && hasToken({ className: 'x-review-product flex', id: '' }, /^(reviews?)/) === true;";
  const fn = new AsyncFn(body);
  return (fn() as Promise<boolean>).then((ok) => assert(ok, "token matching should reject preview-img and accept x-review-product"));
});

// --- popups ---------------------------------------------------------------

Deno.test("with no observation the model is forbidden from mentioning popups", () => {
  // The capture strips them. Silence is correct; "there is no email capture"
  // would be a claim about something never seen.
  const text = popupEvidence(null, false);
  assertStringIncludes(text, "Say NOTHING about popups");
  assert(!text.includes("No popup appeared"));
});

Deno.test("observed but empty is reported as not seen, not as absent", () => {
  const text = popupEvidence([], true);
  assertStringIncludes(text, "not conclusive");
  assertStringIncludes(text, "exit intent");
});

Deno.test("an observed popup is described by behaviour, never by appearance", () => {
  const text = popupEvidence([{
    text: "Get 10% off your first order",
    screen_share: 78,
    has_email_field: true,
    has_close_control: false,
    app: "klaviyo",
    scroll_locked: true,
    when: "on_arrival",
  }], true);
  assertStringIncludes(text, "appeared immediately on arrival");
  assertStringIncludes(text, "78% of the screen");
  assertStringIncludes(text, "NO visible close control");
  assertStringIncludes(text, "locks page scrolling");
  assertStringIncludes(text, "klaviyo");
  assertStringIncludes(text, "Get 10% off your first order");
  assertStringIncludes(text, "never describe the popup's colours or layout");
});

Deno.test("a malformed popup entry cannot break the evidence", () => {
  const text = popupEvidence([null, 42, { screen_share: 10 }], true);
  assertStringIncludes(text, "not conclusive");
});
