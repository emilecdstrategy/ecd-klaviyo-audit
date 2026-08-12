// The vision QA that grades a generated "after" image against the fixes it was
// supposed to apply. Extracted from web_generate_after so the model bake-off
// scores every candidate model with EXACTLY the production judge.
import { createLlmClient, type LlmMessage, type LlmTool } from "./llm-adapter.ts";
import type { Viewport } from "./after-image-prompt.ts";

/** Vision model that grades the generated "after" against the fixes it should show. */
export const VERIFY_MODEL = "claude-sonnet-5";

export const VERIFY_TOOL: LlmTool = {
  name: "record_after_check",
  description:
    "Report whether the redesigned screenshot actually applied every requested fix, and whether the edit introduced any visual defects.",
  input_schema: {
    type: "object",
    required: ["all_applied", "unapplied_fixes", "defects"],
    properties: {
      all_applied: {
        type: "boolean",
        description: "true ONLY if every requested fix is clearly and completely visible in the second image",
      },
      unapplied_fixes: {
        type: "array",
        items: { type: "string" },
        description:
          "One short entry per requested fix that is NOT visibly applied, naming what is still wrong. Be strict: if a fix said to fit a row onto one line and it still wraps to two, or said to add an element and it is not visible, it is NOT applied. TWO RULES FOR FIXES THAT REMOVE, FOLD, MERGE, COLLAPSE OR RELOCATE SOMETHING, and they cut both ways. (1) If the element is STILL VISIBLE in IMG_2 where it was in IMG_1, the fix is NOT applied, however plausible it is that a copy was also added elsewhere. A phone-number bar told to fold into the menu or footer, that still sits as its own full-width strip, is NOT applied. (2) If the element is GONE from IMG_2 and the fix said to move it into somewhere you cannot see, such as a closed hamburger menu, a dropdown, or the footer below the fold, treat it as APPLIED. Do not demand visible proof inside a container you cannot open, and do not report it as missing or as a defect merely because you cannot confirm where it went.",
      },
      defects: {
        type: "array",
        items: { type: "string" },
        description:
          "Visual defects the edit introduced: duplicated text or elements, an element left behind in its old place after a move, overlapping or colliding elements, unreadable text over a photo, empty icon slots, or misspellings. ALSO report each of these as a defect: (a) IMG_2 is in the WRONG DEVICE LAYOUT, i.e. IMG_1 is a narrow phone screenshot but IMG_2 is a wide multi-column desktop layout, or the reverse; (b) the main product photo from IMG_1 is missing, shrunk to a thumbnail, or replaced by a row of thumbnails; (c) product images changed shape, for example square cards in IMG_1 becoming taller or wider in IMG_2, or a photo cropped or stretched; (d) IMG_2 looks more crowded than IMG_1, with smaller text or tighter spacing; (e) any photo is framed differently from IMG_1, i.e. zoomed in, re-centred, or with part of the product sliced off at an edge; (f) IMG_1 shows a cart drawer pinned to the right edge with the page visible behind it but IMG_2 centres the cart, turns it into a modal, or blanks out the page behind it; (g) IMG_2's cart drawer is taller than IMG_1's, or a line that fitted on one row in IMG_1 now wraps onto two; (h) a floating widget is DUPLICATED or INVENTED, i.e. a chat bubble, loyalty or rewards star, or back-to-top button that appears once in IMG_1 appears twice or more in IMG_2, has moved to a different corner, or appears in IMG_2 having been absent from IMG_1 entirely. Count the floating badges in each image and compare the totals, and say explicitly when one was ADDED; (h2) ON A CART, THE CHECKOUT BUTTON IS THE POINT OF THE PAGE: it must sit fully inside the frame with its whole label readable. If the drawer grew and pushed the checkout button, the total, or that block partly or wholly out of view, report it and name the checkout button. A cart a shopper cannot check out from is a broken image, not a rough one; (i) THE GRID GAINED COLUMNS: count the product cards per row in IMG_1 and in IMG_2. If IMG_1 is a phone screenshot showing ONE full-width card per row and IMG_2 shows two or more side by side, that is a serious defect. Narrowing the cards forces every product photo to be re-cropped, so report it explicitly as 'grid changed from one card per row to N per row'. All of these are serious.",
      },
    },
  },
};

export type VerifyResult = { ok: boolean; feedback: string; defects: string[]; missing: string[] };

/** Defects about the PHOTOS themselves (reshaped, cropped, zoomed, removed).
 * These are the ones that make an image look broken to a client rather than
 * merely unfinished, so they are weighted far above a skipped fix. */
export function isPhotoDefect(defect: string): boolean {
  // The bare word "thumbnail" once matched a verdict about a duplicated badge
  // "near the product thumbnails", which routed the retry into fewer-fixes mode
  // and cost two perfectly good fixes. Only the photo-REPLACED-by-thumbnails
  // failure is photo damage; a thumbnail merely being mentioned is not.
  // "Photo geometry changed:" is the dedicated photo pass's own prefix, and
  // substitution (a different photo entirely) is the worst version of this
  // failure, so both must match rather than relying on the wording that follows.
  // A phone grid gaining columns counts as photo damage even though it reads as
  // a layout change: narrowing the cards is precisely what forces every product
  // photo to be re-cropped, so it has to carry the same weight and drive the
  // same retry as the crop it causes.
  return /photo geometry|different (photo|image)|substitut|swapped|fabricat|invented|crop|aspect|stretch|squash|zoom|re-?cent|framing|sliced|cut off|taller|wider|squar|shape|per row|multi-?column|grid changed|replaced by.{0,20}thumbnails?|missing.*photo|photo.*missing/i
    .test(defect);
}

/** A photo replaced by different imagery, rather than merely reshaped. This is
 * the worst outcome the pipeline can produce: it shows a client products that
 * are not theirs, so it outranks every other defect by an order of magnitude. */
export function isSubstitutedPhoto(defect: string): boolean {
  // Allow adjectives between "different" and the noun: the judge writes things
  // like "a different composite image" and "a different product photo".
  return /substitut|fabricat|invented|different(\s+\w+){0,3}\s+(photo|image|product|scene|shot|content)/i
    .test(defect);
}

/** A defect that breaks the PURPOSE of the page rather than its polish: a cart
 * with no reachable checkout button is not a concept, it is a broken picture.
 * The judge already reports these ("the Checkout button extends beyond the
 * visible frame"), but only photo defects were ever gated on, so a cart missing
 * its checkout button was recorded and published anyway. */
export function isCriticalLayoutDefect(defect: string): boolean {
  const d = defect.toLowerCase();
  const aboutCheckout = /checkout|add to cart|buy (now|button)|primary (button|cta)/.test(d);
  const gone = /cut off|cutoff|beyond the visible|out of (the )?(frame|view)|not visible|missing|hidden|off-?screen|clipped|extends? below/
    .test(d);
  if (aboutCheckout && gone) return true;
  // A drawer that grew taller is the usual cause of the above, so it is treated
  // as critical on its own: on a cart, height IS the checkout button's visibility.
  return /(drawer|cart).{0,30}(taller|grew|expanded|longer)|taller.{0,20}(drawer|cart)/.test(d);
}

/** A floating widget that was NOT in the original. The duplicate check only
 * catches one appearing twice; a chat bubble invented on a page that never had
 * one is just as wrong and reads as sloppy. */
export function isInventedWidgetDefect(defect: string): boolean {
  const d = defect.toLowerCase();
  return /(chat|bubble|widget|badge|loyalty|rewards|back-?to-?top)/.test(d) &&
    /(added|new|appears?|introduc|not present|did not exist|wasn'?t (in|present))/.test(d);
}

/** Lower is better. A photo defect outweighs every skipped fix, because the
 * fixes still appear as text in the report while a mangled photo does not, and
 * a SUBSTITUTED photo outweighs a merely reshaped one. A critical layout defect
 * sits with the photo defects: both make the image unusable rather than
 * imperfect. */
export function verifyScore(v: VerifyResult): number {
  const substituted = v.defects.filter(isSubstitutedPhoto).length;
  const photo = v.defects.filter((d) => isPhotoDefect(d) && !isSubstitutedPhoto(d)).length;
  const critical = v.defects.filter((d) => !isPhotoDefect(d) && isCriticalLayoutDefect(d)).length;
  const other = v.defects.length - substituted - photo - critical;
  return substituted * 1000 + photo * 100 + critical * 100 + other * 10 + v.missing.length;
}

/** Check the generated "after" against the fixes it was supposed to apply. The
 * image model often produces a pretty screenshot that quietly skips a structural
 * change (reflowing a nav to one row) or an addition (a notify-me button), so we
 * grade the result and feed the misses back for one corrective attempt. Never
 * throws: if the check itself fails we accept the image as-is. */
export async function verifyAfterImage(
  beforeUrl: string,
  afterUrl: string,
  recommendations: string[],
  viewport: Viewport,
): Promise<VerifyResult> {
  if (recommendations.length === 0) return { ok: true, feedback: "", defects: [], missing: [] };
  try {
    const llm = createLlmClient("anthropic", { model: VERIFY_MODEL });
    const fixes = recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const messages: LlmMessage[] = [{
      role: "user_images",
      text:
        `IMG_1 is the ORIGINAL ${viewport} screenshot. IMG_2 is an AI redesign of it that was supposed to apply these fixes:\n\n${fixes}\n\n` +
        `Compare the two images and judge STRICTLY whether each fix is genuinely visible in IMG_2. A fix that was only partially done does not count as applied. Also report any defect the edit introduced, especially duplicated text or elements, or an element that was supposed to move but is still in its old position.\n\n` +
        `For a fix that removes, folds, merges or relocates something, decide it on ONE question: is that element still visible in IMG_2? Still visible means NOT applied. Gone means applied, even when the fix said to tuck it into a closed menu or the footer that you cannot see into. Never mark such a fix missing just because you cannot confirm where the element went.\n\n` +
        `Call record_after_check exactly once.`,
      images: [
        { url: beforeUrl, label: "IMG_1: original" },
        { url: afterUrl, label: "IMG_2: redesign to grade" },
      ],
    }];
    const turn = await llm.runTurn({
      system:
        "You are a meticulous design QA reviewer. You compare a redesigned screenshot against the original and the list of fixes it was meant to apply, and you report honestly and strictly what was not done. Never give the benefit of the doubt.",
      messages,
      tools: [VERIFY_TOOL],
      toolChoice: { type: "tool", name: "record_after_check" },
    });
    if (turn.kind !== "tool_call") return { ok: true, feedback: "", defects: [], missing: [] };
    const out = (turn.input ?? {}) as { all_applied?: unknown; unapplied_fixes?: unknown; defects?: unknown };
    const missing = Array.isArray(out.unapplied_fixes) ? out.unapplied_fixes.map(String).filter(Boolean) : [];
    const defects = Array.isArray(out.defects) ? out.defects.map(String).filter(Boolean) : [];
    if (out.all_applied === true && defects.length === 0) return { ok: true, feedback: "", defects: [], missing: [] };
    if (missing.length === 0 && defects.length === 0) return { ok: true, feedback: "", defects: [], missing: [] };
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`These required fixes were NOT applied in your previous attempt, you MUST make each one clearly visible this time:\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}`);
    if (defects.length > 0) parts.push(`Your previous attempt also introduced these defects, which you MUST avoid:\n${defects.map((d, i) => `${i + 1}. ${d}`).join("\n")}`);
    return { ok: false, feedback: parts.join("\n\n"), defects, missing };
  } catch {
    return { ok: true, feedback: "", defects: [], missing: [] };
  }
}

const CHECKOUT_TOOL = {
  name: "record_checkout_check",
  description: "Report whether the cart's checkout button is fully visible.",
  input_schema: {
    type: "object" as const,
    required: ["checkout_fully_visible"],
    properties: {
      checkout_fully_visible: {
        type: "boolean",
        description:
          "true ONLY if a checkout button is present AND completely inside the image, with its full label readable and nothing about it cut off by the bottom or side edge. false if it is missing entirely, sliced by an edge, or only partly in frame.",
      },
      note: { type: "string", description: "One short sentence on what you see at the bottom of the cart." },
    },
  },
};

/**
 * A single, narrow question: is the checkout button fully visible?
 *
 * The combined rubric asks about eight defect classes at once and it MISSED a
 * cart whose checkout button was sliced off the bottom, twice, even with an
 * explicit clause telling it to look. That is the same lesson photo cropping
 * taught: one focused question is far more reliable than a clause inside a long
 * list, and this is the defect that makes a cart concept worthless. Never
 * throws: a failed check reports visible, because withholding on the checker
 * itself breaking would be worse than the defect.
 */
export async function verifyCheckoutVisible(afterUrl: string): Promise<{ visible: boolean; note: string }> {
  try {
    const llm = createLlmClient("anthropic", { model: VERIFY_MODEL });
    const turn = await llm.runTurn({
      system:
        "You inspect one screenshot of a shopping cart and answer exactly one question about the checkout button. You do not comment on anything else.",
      messages: [{
        role: "user_images",
        text:
          "This is a shopping cart (or slide-out cart drawer). Look at it and answer one question: is there a checkout button that is FULLY visible, entirely inside the image, with its whole label readable and no part of it cut off by the bottom edge?\n\n" +
          "Look carefully at the very bottom of the cart. A cart that ends on a subtotal, a taxes note, or a partly-drawn button has NO fully visible checkout button. Call record_checkout_check exactly once.",
        images: [{ url: afterUrl, label: "cart" }],
      }],
      tools: [CHECKOUT_TOOL],
      toolChoice: { type: "tool", name: "record_checkout_check" },
    });
    if (turn.kind !== "tool_call") return { visible: true, note: "" };
    const out = (turn.input ?? {}) as { checkout_fully_visible?: unknown; note?: unknown };
    return {
      visible: out.checkout_fully_visible !== false,
      note: typeof out.note === "string" ? out.note.slice(0, 200) : "",
    };
  } catch {
    return { visible: true, note: "" };
  }
}

const PHOTO_TOOL = {
  name: "record_photo_check",
  description: "Report whether any photograph was altered geometrically.",
  input_schema: {
    type: "object" as const,
    required: ["altered_photos"],
    properties: {
      altered_photos: {
        type: "array",
        items: { type: "string" },
        description:
          "One entry per photograph in IMG_2 that is not the identical photograph from IMG_1. Report BOTH kinds of change. (1) SUBSTITUTION, the most serious: the photo shows different content, a different product, a different scene, or looks redrawn or invented. Start those entries with the word SUBSTITUTED. (2) GEOMETRY: a different aspect ratio (a square card now taller or wider), a tighter or looser crop, a zoom, a shifted centre point, part of the product sliced off at an edge, or a photo turned into a circle or other new shape. Say which photo and what changed. WHAT IS NOT AN ALTERATION, never report these: a photo partially COVERED by a new panel, overlay, badge or pill (occlusion is not a geometry change; the photo behind it is intact); new imagery that one of the listed fixes plainly calls for, such as category tiles, a cart panel, or a reviews strip; a photo you cannot see well enough in BOTH images to compare, for example one cut off at the frame edge (inconclusive means say nothing, not report it); and a photo that is unchanged (never write an entry that itself says the photo was not altered). DO still report, as SUBSTITUTED, any new photographic scene that NO listed fix asks for: that is invented imagery. Empty array only if every photo that appears in both images has the same framing and proportions.",
      },
    },
  },
};

/**
 * A second, single-purpose pass that looks ONLY at photo geometry.
 *
 * The main verifier grades every fix AND scans for eight defect classes in one
 * call, and photo cropping kept slipping through it: a product page came back
 * with the square hero photo cropped to a wide strip and the verdict recorded
 * zero defects. One narrow question is far more reliable than a clause inside a
 * long rubric, and this is the defect the client notices first.
 */
export async function verifyPhotoFidelity(
  beforeUrl: string,
  afterUrl: string,
  recommendations: string[] = [],
): Promise<string[]> {
  try {
    const llm = createLlmClient("anthropic", { model: VERIFY_MODEL });
    // The checker must know what the redesign was ASKED to do: without this it
    // flagged requested additions (category tiles, an opened cart panel) and
    // photos merely covered by a new element as photo damage, and half the
    // Power Planter afters were withheld for changes the fixes demanded.
    const fixesNote = recommendations.length
      ? `\n\nThe redesign was asked to make these changes, so imagery they plainly call for is EXPECTED, not an alteration:\n${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
      : "";
    const turn = await llm.runTurn({
      system:
        "You are a photo-geometry checker. You do not care about layout, wording, colour, or whether any redesign is good. You compare ONLY the photographs in two screenshots and report any whose shape, crop, framing, or zoom changed.",
      messages: [{
        role: "user_images",
        text:
          "IMG_1 is the original screenshot. IMG_2 is a redesign of it. Look at every photograph in both.\n\n" +
          "For each photo, ask: is it the same shape, the same crop, and the same amount of the product in frame? " +
          "A square product card that is now rectangular is altered. A photo zoomed in so the product fills more of the frame is altered. " +
          "A photo whose subject is now sliced by an edge is altered. A photo made circular is altered. " +
          "Repositioning a photo, or changing its overall size while keeping the same proportions and crop, is NOT altered. " +
          "A photo partially covered by a new panel, overlay or badge is NOT altered: occlusion is not a geometry change. " +
          "A wide banner showing a SHORTER BAND of the same photo at the same scale, with the subject the same size and in the same place, is NOT altered when a fix asked to trim or shorten that banner: that is the fix working. It IS altered if the photo was squashed, stretched, zoomed, or re-centred to fit. " +
          "A photo you cannot see well enough in both images to compare is NOT reportable: inconclusive means say nothing. " +
          "Never write an entry that itself says a photo is unchanged." +
          fixesNote + "\n\n" +
          "Call record_photo_check exactly once.",
        images: [
          { url: beforeUrl, label: "IMG_1: original" },
          { url: afterUrl, label: "IMG_2: redesign" },
        ],
      }],
      tools: [PHOTO_TOOL],
      toolChoice: { type: "tool", name: "record_photo_check" },
    });
    if (turn.kind !== "tool_call") return [];
    const out = (turn.input ?? {}) as { altered_photos?: unknown };
    return Array.isArray(out.altered_photos) ? out.altered_photos.map(String).filter(Boolean) : [];
  } catch {
    // Never block publishing on the checker itself failing.
    return [];
  }
}
