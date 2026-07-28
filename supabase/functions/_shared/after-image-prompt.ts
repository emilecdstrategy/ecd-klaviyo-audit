// The production prompt and Gemini call for "after" concept images, extracted
// from web_generate_after so the model bake-off script can drive candidate
// models with EXACTLY the prompt production uses. Behavior-identical move.
import { layoutGuidance, type WebPageKind } from "./ecommerce-ux-kb.ts";

export type Viewport = "desktop" | "mobile";
export type CapturedEl = { label?: string; w?: number; h?: number };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Read a PNG's pixel dimensions straight out of the IHDR chunk (width and
 * height are big-endian uint32 at byte offsets 16 and 20). Lets us check the
 * generated image's SHAPE deterministically instead of trusting the model to
 * honour "keep the same aspect ratio". */
export function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  // PNG signature
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const read32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const w = read32(16);
  const h = read32(20);
  if (!w || !h) return null;
  return { w, h };
}

/** Is the generated image the wrong SHAPE for the device? A phone screenshot is
 * portrait and a desktop one is landscape; the image model sometimes returns a
 * wide desktop-looking layout for a mobile source, which is unusable. */
export function wrongShape(source: Uint8Array, generated: Uint8Array): boolean {
  const a = pngSize(source);
  const b = pngSize(generated);
  if (!a || !b) return false; // can't tell, don't block
  const srcRatio = a.w / a.h;
  const genRatio = b.w / b.h;
  // Orientation flip (portrait source -> landscape output, or the reverse).
  if (srcRatio < 1 && genRatio >= 1) return true;
  if (srcRatio > 1 && genRatio <= 1) return true;
  // Same orientation but a very different shape (more than ~45% off) also reads
  // as broken next to the original.
  return Math.abs(genRatio - srcRatio) / srcRatio > 0.45;
}

/** Describe the shape of the repeated product photos, measured from the real DOM
 * boxes captured with the screenshot. Telling the model "these are square" beats
 * telling it "do not change the aspect ratio", which it has ignored repeatedly. */
export function photoShapeNote(elements: CapturedEl[] | undefined, png: { w: number; h: number } | null): string | null {
  if (!png || png.w <= 0 || png.h <= 0) return null;
  // Cards only: wide enough to be a product photo rather than a logo or icon.
  const cards = (elements ?? []).filter(
    (e) => typeof e.label === "string" && /^img\b/i.test(e.label) && (e.w ?? 0) >= 20 && (e.h ?? 0) >= 4,
  );
  if (cards.length < 2) return null;
  const ratios = cards
    .map((e) => ((e.w as number) / 100 * png.w) / ((e.h as number) / 100 * png.h))
    .filter((r) => Number.isFinite(r) && r > 0.1 && r < 10)
    .sort((a, b) => a - b);
  if (ratios.length < 2) return null;
  const median = ratios[Math.floor(ratios.length / 2)];
  // Only speak up when the photos agree with each other, so a page of mixed
  // shapes does not get told they are all one shape.
  const consistent = ratios.every((r) => Math.abs(r - median) / median <= 0.15);
  if (!consistent) return null;
  if (Math.abs(median - 1) <= 0.06) {
    return "The product photos in the source are SQUARE (1:1).";
  }
  const wide = Math.round(median * 100) / 100;
  return `The product photos in the source are ${median > 1 ? "landscape" : "portrait"}, about ${wide} wide for every 1 tall.`;
}

export function buildEditPrompt(
  label: string,
  recommendations: string[],
  hasReference: boolean,
  viewport: Viewport,
  pageKind: WebPageKind,
  freezeFloatingWidgets = false,
  hasBelowFold = false,
  photoShape: string | null = null,
): string {
  const fixes = recommendations
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  const deviceRules = viewport === "mobile"
    ? `This is the MOBILE view. Follow native mobile UX conventions strictly: keep the primary navigation collapsed inside the hamburger menu, NEVER expand it into a horizontal row or list of text links. Stack content vertically in a single column, and that includes any product grid: exactly ONE product card per row, full width, never two side by side. Make every tap target large and well spaced (at least 44x44px). Keep the key content and one call-to-action within thumb reach. Never shrink, crowd, or create tiny clickable elements.`
    : `This is the DESKTOP view. Use standard desktop conventions: a horizontal top navigation and multi-column layouts are fine.`;

  // Knowing the real next section stops the two classic failures: an empty band
  // at the bottom, and invented filler products with made-up names and prices.
  const belowFoldRule = hasBelowFold
    ? [`- The FINAL image provided is NOT part of your output. It shows the real content that continues immediately BELOW this screenshot, for reference only. Keep your output framed exactly like the FIRST image (same top, same height, same aspect ratio). If your changes free up space at the bottom, fill it by continuing with the REAL next content from that final reference image, cropped naturally as a page would be. NEVER invent placeholder products, names, or prices, and NEVER leave an empty or blank band at the bottom.`]
    : [`- If your changes free up space at the bottom, do NOT invent placeholder products, names, or prices to fill it, and do not leave a blank band: keep the existing sections and let the last one crop naturally at the bottom edge, exactly as the source screenshot does.`];

  // Always frozen. This used to be conditional on a floating-widget fix having
  // been dropped, but the model duplicates these badges even when no fix
  // mentions them: a page with one loyalty star came back with two.
  const freezeRule = [
    `- FLOATING ICONS ARE FROZEN: reproduce every floating widget (chat bubble, rewards or loyalty badge, back-to-top button) EXACTLY as it appears in the source, the same icon in the same corner, each appearing ONCE. Do NOT move them, do NOT resize them, and above all do NOT draw an extra copy anywhere. There must be exactly as many floating icons in your output as in the source, no more.${
      freezeFloatingWidgets
        ? ` A fix asking to move or reposition one of these was deliberately withheld from the list above, so there is nothing for you to change about them at all.`
        : ``
    }`,
  ];

  const common = [
    `Design rules:`,
    ...belowFoldRule,
    ...freezeRule,
    `- LAYOUT (follow these standard e-commerce patterns exactly): ${layoutGuidance(pageKind)}`,
    `- ${deviceRules}`,
    `- Use EXACTLY ONE primary call-to-action in the hero. Never create duplicate or competing CTA buttons (e.g. do not show both "Shop Now" and "Shop the Bundle").`,
    `- Keep all existing real text and numbers from the source (headlines, prices, phone numbers, product names) unless a fix changes them.`,
    `- If a fix calls for a new element such as a badge, star rating, or trust signal, DEPICT it as a real graphic (actual stars, an actual badge). NEVER write the element's name or a description as literal text on the page (no "Bestseller Badge", "hero image", "CTA button", "trust badge" text).`,
    `- READABILITY IS CRITICAL: any text placed over a photo must be easy to read. Add a dark gradient or semi-transparent scrim behind the text (or place the text on a solid color panel) so it has strong contrast. Never leave light text sitting on a busy or light photo where it is hard to read.`,
    `- Every button, pill, chip, or element must look FINISHED and real: text centered and aligned, consistent padding, no empty icon boxes, no blank slots, no missing or broken icons. If you cannot render a clean icon, use text only, do not leave an empty space where an icon would go.`,
    `- Keep all text crisp, correctly spelled, and legible. Do not add annotations, numbered markers, callouts, arrows, borders, captions, or watermarks, and never render any of these instructions into the image.`,
    `- OUTPUT FRAMING: match the source screenshot's aspect ratio, width, and vertical extent as closely as you can. Show the same span of the page from top to bottom. Do not zoom in, do not crop content away, and do not return a shorter or squarer image than the source: the result is displayed side by side with the original, so a different shape looks broken.`,
    `- Output only the clean, polished, production-quality redesigned screenshot, as if it were a real live page.`,
  ].join("\n");

  // Repeated last, on purpose. These are the failures that make an image
  // unusable rather than merely imperfect, and they were getting lost inside the
  // long rule list above.
  const hardConstraints = [
    `ABSOLUTE CONSTRAINTS. Breaking any of these makes the image unusable, no matter how good the rest is:`,
    photoShape
      ? `1. PHOTO SHAPE IS FIXED. ${photoShape} Reproduce every product photo at that exact shape. Do not make them taller, wider, or squarer.`
      : `1. PHOTO SHAPE IS FIXED. Every product photo keeps the exact aspect ratio it has in the source. If the grid cards are square, every card in your output is square.`,
    `2. PHOTO FRAMING IS FIXED. Never crop, zoom, or re-centre a photo. The same amount of the product stays in shot with the same margins. If you need vertical space, take it from padding, gaps, or headings, never from inside an image.`,
    `3. Never remove or shrink the main product photo, and never replace it with thumbnails.`,
    `4. A slide-out cart stays exactly where it is: on desktop, pinned to the right edge with the page still visible behind it. Never centre it and never blank out the page behind it.`,
    `5. Nothing may get taller than it is in the source. A cart drawer, a header, or a line of text that fits one row must still fit one row.`,
    `6. COUNT THE FLOATING BADGES. Every floating widget (chat bubble, loyalty or rewards star, back-to-top) appears EXACTLY ONCE, in the same corner as the source. Before you finish, count them: two loyalty stars, or a chat bubble in two corners, is a broken image.`,
  ].join("\n");

  if (hasReference) {
    // Mirror mode: image 1 is the current screenshot for THIS viewport, image 2
    // is the already-approved redesign for the OTHER viewport. Match the CONTENT
    // decisions but rebuild the STRUCTURE natively for this device.
    return [
      `The FIRST image is a real screenshot of the ${label} of an e-commerce store.`,
      `The SECOND image is the approved "after" redesign of the SAME page on the OTHER device.`,
      viewport === "mobile"
        ? `MANDATORY OUTPUT SHAPE: your image must be a TALL, NARROW SINGLE-COLUMN PHONE screenshot matching the FIRST image's aspect ratio and width. The SECOND image is a wide desktop layout: do NOT copy its shape, column count, or navigation. Copying the desktop layout onto the phone is the single worst mistake you can make here.`
        : `MANDATORY OUTPUT SHAPE: your image must be a WIDE DESKTOP screenshot matching the FIRST image's aspect ratio. The SECOND image is a narrow phone layout: do NOT copy its shape or its collapsed mobile navigation.`,
      `Match the SECOND image's CONTENT and messaging decisions: the same new headline and body copy, the same offer, and the same primary call-to-action wording. But rebuild the STRUCTURE natively for THIS device using the rules below. Do NOT copy the other device's navigation style, column count, or layout (in particular, never turn a mobile menu into a desktop-style horizontal nav).`,
      `On top of matching the reference, you MUST actually apply these ${viewport}-specific fixes (make the change clearly visible, e.g. real added spacing, larger tap targets, a repositioned or added element):`,
      fixes || "Improve visual hierarchy, spacing, and clarity of the primary call to action.",
      `Keep the brand's real logo, product photos, color palette, and typography intact so it clearly reads as the same store.`,
      common,
      hardConstraints,
    ].join("\n\n");
  }

  return [
    `This image is a real screenshot of the ${label} of an e-commerce store.`,
    `Produce an improved "after" redesign of THIS EXACT page as a realistic screenshot of the same website.`,
    `Keep the brand's real logo, product photos, color palette, and typography intact so it clearly reads as the same store. Keep the same overall page structure and aspect ratio; change only what the fixes below require.`,
    `Apply these specific conversion and UX fixes:`,
    fixes || "Improve visual hierarchy, clarity of the primary call to action, and overall polish.",
    common,
    hardConstraints,
  ].join("\n\n");
}

export type GeminiImageOptions = {
  model: string;
  referencePng?: Uint8Array;
  belowFoldPng?: Uint8Array;
  /** Generate several candidates in ONE call; the caller picks between them. */
  candidateCount?: number;
  timeoutMs?: number;
};

/** Calls Gemini image editing: source screenshot in, edited screenshot(s) out.
 * When a reference image is supplied (the sibling viewport's approved "after"),
 * it is sent as a second image so the model mirrors the same changes across
 * viewports. Returns one image per candidate (usually one). */
export async function geminiEditImage(
  sourcePng: Uint8Array,
  prompt: string,
  apiKey: string,
  opts: GeminiImageOptions,
): Promise<Uint8Array[]> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${apiKey}`;
  const requestParts: Array<Record<string, unknown>> = [
    { inlineData: { mimeType: "image/png", data: bytesToBase64(sourcePng) } },
  ];
  if (opts.referencePng) requestParts.push({ inlineData: { mimeType: "image/png", data: bytesToBase64(opts.referencePng) } });
  // The below-the-fold context image always goes LAST so its position in the
  // prompt text ("the FINAL image shows what continues below") stays stable.
  if (opts.belowFoldPng) requestParts.push({ inlineData: { mimeType: "image/png", data: bytesToBase64(opts.belowFoldPng) } });
  requestParts.push({ text: prompt });
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"], temperature: 0.4 };
  if (opts.candidateCount && opts.candidateCount > 1) generationConfig.candidateCount = opts.candidateCount;
  // Bounded like the llm-adapter (110s): an unanswered image call used to hold
  // the edge invocation open until the platform killed it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 110_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: requestParts }],
        generationConfig,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("gemini_timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`gemini_http_${res.status}: ${detail}`);
  }
  const data = await res.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  } | null;
  const out: Uint8Array[] = [];
  for (const candidate of data?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      const inline = (part.inlineData ?? part.inline_data) as { data?: string; mimeType?: string } | undefined;
      if (inline?.data) {
        out.push(base64ToBytes(inline.data));
        break;
      }
    }
  }
  if (out.length === 0) throw new Error("gemini_no_image_returned");
  return out;
}
