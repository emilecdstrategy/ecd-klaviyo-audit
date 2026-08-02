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
          "Visual defects the edit introduced: duplicated text or elements, an element left behind in its old place after a move, overlapping or colliding elements, unreadable text over a photo, empty icon slots, or misspellings. ALSO report each of these as a defect: (a) IMG_2 is in the WRONG DEVICE LAYOUT, i.e. IMG_1 is a narrow phone screenshot but IMG_2 is a wide multi-column desktop layout, or the reverse; (b) the main product photo from IMG_1 is missing, shrunk to a thumbnail, or replaced by a row of thumbnails; (c) product images changed shape, for example square cards in IMG_1 becoming taller or wider in IMG_2, or a photo cropped or stretched; (d) IMG_2 looks more crowded than IMG_1, with smaller text or tighter spacing; (e) any photo is framed differently from IMG_1, i.e. zoomed in, re-centred, or with part of the product sliced off at an edge; (f) IMG_1 shows a cart drawer pinned to the right edge with the page visible behind it but IMG_2 centres the cart, turns it into a modal, or blanks out the page behind it; (g) IMG_2's cart drawer is taller than IMG_1's, or a line that fitted on one row in IMG_1 now wraps onto two; (h) a floating widget is DUPLICATED, i.e. a chat bubble, loyalty or rewards star, or back-to-top button that appears once in IMG_1 appears twice or more in IMG_2, or has moved to a different corner. Count the floating badges in each image and compare the totals. All of these are serious.",
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
  return /crop|aspect|stretch|squash|zoom|re-?cent|framing|sliced|cut off|taller|wider|squar|shape|replaced by.{0,20}thumbnails?|missing.*photo|photo.*missing/i
    .test(defect);
}

/** Lower is better. A photo defect outweighs every skipped fix, because the
 * fixes still appear as text in the report while a mangled photo does not. */
export function verifyScore(v: VerifyResult): number {
  const photo = v.defects.filter(isPhotoDefect).length;
  const other = v.defects.length - photo;
  return photo * 100 + other * 10 + v.missing.length;
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
