/**
 * Photo compositing for the after-images.
 *
 * The generative model cannot reproduce a photograph exactly, so every hero and
 * product shot it repaints drifts a little, and the photo gate (rightly)
 * withholds the result. This module removes the photos from the model's job:
 *
 *  - maskPhotos()   paints every photo region (from the capture-time inventory
 *                   in web_page_snapshots.raw.photos) as a solid magenta slot
 *                   BEFORE generation, with a prompt telling the model these
 *                   are locked placeholders it must carry through unchanged.
 *  - restorePhotos() finds each magenta slot in the model's output by exact
 *                   colour (no correlation, no alignment guessing) and pastes
 *                   the client's own pixels from the source screenshot into it.
 *
 * A photo the model was never shown cannot be cropped, substituted or
 * re-drawn: after restore it is the original by construction. Slots the model
 * destroyed anyway are reported so the caller can fall back or withhold.
 *
 * Pure bitmap math on ImageScript's RGBA buffer; no native deps, works inside
 * the edge runtime. Nearest-neighbour is used for the paste scaling: slots come
 * back within a few percent of their source size, and NN never bleeds
 * neighbouring page pixels into the photo the way a smoothing kernel would.
 */

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

/** One photo as inventoried at capture time; box is % of the screenshot. */
export type PhotoBox = { x: number; y: number; w: number; h: number; src?: string };

/** Lock-slot colour. Pure magenta never occurs in real storefront imagery. */
const SLOT = { r: 255, g: 0, b: 255 };
/** Channel tolerance when re-finding slots: the model re-encodes the image, so
 * expect a little wobble around the pure value. */
const TOL = 48;

export type SlotReport = {
  index: number;
  src?: string;
  expected: { x: number; y: number; w: number; h: number };
  found: { x: number; y: number; w: number; h: number } | null;
  /** Fraction of the found bounding box that is actually slot-coloured. A low
   * purity means the model drew INTO the slot, so pasting over it would also
   * paste over whatever it drew. */
  purity: number;
};

function toPx(b: PhotoBox, w: number, h: number) {
  return {
    x: Math.max(0, Math.round((b.x / 100) * w)),
    y: Math.max(0, Math.round((b.y / 100) * h)),
    w: Math.min(w, Math.round((b.w / 100) * w)),
    h: Math.min(h, Math.round((b.h / 100) * h)),
  };
}

/** Paint every inventoried photo as a solid magenta slot. Returns the masked
 * PNG plus the pixel boxes that were painted (in source coordinates). */
export async function maskPhotos(
  sourcePng: Uint8Array,
  photos: PhotoBox[],
): Promise<{ png: Uint8Array; boxes: Array<{ x: number; y: number; w: number; h: number }> }> {
  const img = await Image.decode(sourcePng);
  const boxes = photos.map((p) => toPx(p, img.width, img.height));
  for (const b of boxes) {
    for (let y = b.y; y < Math.min(img.height, b.y + b.h); y++) {
      for (let x = b.x; x < Math.min(img.width, b.x + b.w); x++) {
        const i = (y * img.width + x) * 4;
        img.bitmap[i] = SLOT.r;
        img.bitmap[i + 1] = SLOT.g;
        img.bitmap[i + 2] = SLOT.b;
        img.bitmap[i + 3] = 255;
      }
    }
  }
  return { png: await img.encode(), boxes };
}

function isSlotColour(bitmap: Uint8ClampedArray, i: number): boolean {
  return Math.abs(bitmap[i] - SLOT.r) <= TOL &&
    bitmap[i + 1] <= TOL &&
    Math.abs(bitmap[i + 2] - SLOT.b) <= TOL;
}

type Rect = { x: number; y: number; w: number; h: number };

/** All solid slot-coloured rectangles in the image, found by flood fill over a
 * binary mask. Global on purpose: a fix that moves content moves the slots with
 * it, and the first spike run proved slots travel much further than any
 * near-the-expected-spot window tolerates (two card slots moved ~150px down and
 * were missed). Components touching each other merge naturally; side-by-side
 * cards keep their separating gutter so they stay distinct. */
function findSlotComponents(img: Image): Array<Rect & { purity: number }> {
  const w = img.width, h = img.height;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    if (isSlotColour(img.bitmap, i)) mask[p] = 1;
  }
  const seen = new Uint8Array(w * h);
  const out: Array<Rect & { purity: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const px = p % w, py = (p / w) | 0;
      count++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      // 4-connectivity is enough for solid rectangles.
      if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    // Anything photo-sized counts; specks (anti-aliased edges, tinted pixels in
    // gradients) do not.
    if (cw >= 24 && ch >= 24 && count >= 1200) {
      out.push({ x: x0, y: y0, w: cw, h: ch, purity: +(count / (cw * ch)).toFixed(3) });
    }
  }
  return out;
}

/** Locate each slot in the generated image and paste the original photo pixels
 * back into it. Slots are matched globally (nearest centre, greedy, best first)
 * rather than searched for near their old position, because applied fixes move
 * them. The paste is COVER-fit: the model may return a slot at a different
 * shape (a shortened hero band), and squashing the photo into it would be the
 * exact geometry damage this module exists to prevent, so the original is
 * scaled to fill and centre-cropped instead. Unmatched slots are reported so
 * the caller can retry, fall back, or withhold. */
export async function restorePhotos(
  sourcePng: Uint8Array,
  generatedPng: Uint8Array,
  photos: PhotoBox[],
): Promise<{ png: Uint8Array; report: SlotReport[] }> {
  const src = await Image.decode(sourcePng);
  const gen = await Image.decode(generatedPng);

  const components = findSlotComponents(gen);
  const expected = photos.map((p) => toPx(p, gen.width, gen.height));

  // Greedy assignment by centre distance, closest pair first. With at most a
  // few dozen slots the O(n^2 log n) is nothing.
  const pairs: Array<{ pi: number; ci: number; d: number }> = [];
  for (let pi = 0; pi < expected.length; pi++) {
    for (let ci = 0; ci < components.length; ci++) {
      const e = expected[pi], c = components[ci];
      const d = Math.hypot((e.x + e.w / 2) - (c.x + c.w / 2), (e.y + e.h / 2) - (c.y + c.h / 2));
      pairs.push({ pi, ci, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const slotByPhoto = new Map<number, number>();
  const usedComponents = new Set<number>();
  for (const { pi, ci } of pairs) {
    if (slotByPhoto.has(pi) || usedComponents.has(ci)) continue;
    // A match further away than half the image height is not the same slot.
    const e = expected[pi], c = components[ci];
    if (Math.hypot((e.x + e.w / 2) - (c.x + c.w / 2), (e.y + e.h / 2) - (c.y + c.h / 2)) > gen.height / 2) continue;
    slotByPhoto.set(pi, ci);
    usedComponents.add(ci);
  }

  const report: SlotReport[] = [];
  for (let pi = 0; pi < photos.length; pi++) {
    const srcBox = toPx(photos[pi], src.width, src.height);
    const entry: SlotReport = { index: pi, src: photos[pi].src, expected: expected[pi], found: null, purity: 0 };
    const ci = slotByPhoto.get(pi);
    if (ci !== undefined) {
      const c = components[ci];
      entry.purity = c.purity;
      // Purity of a clean solid rectangle is ~1. Well below that means the
      // component is an L-shape or the model drew into the slot; pasting a
      // rectangle over it would cover real content.
      if (c.purity >= 0.85) {
        entry.found = { x: c.x, y: c.y, w: c.w, h: c.h };
        // COVER-fit: scale the source photo to fill the slot while keeping its
        // aspect ratio, cropping the overflow evenly. srcW/srcH is the region
        // of the source photo actually shown.
        const scale = Math.max(c.w / srcBox.w, c.h / srcBox.h);
        const cropW = Math.min(srcBox.w, Math.round(c.w / scale));
        const cropH = Math.min(srcBox.h, Math.round(c.h / scale));
        const cropX = srcBox.x + ((srcBox.w - cropW) >> 1);
        const cropY = srcBox.y + ((srcBox.h - cropH) >> 1);
        for (let ty = 0; ty < c.h; ty++) {
          const sy = cropY + Math.min(cropH - 1, Math.floor((ty / c.h) * cropH));
          for (let tx = 0; tx < c.w; tx++) {
            const sx = cropX + Math.min(cropW - 1, Math.floor((tx / c.w) * cropW));
            const si = (sy * src.width + sx) * 4;
            const gi = ((c.y + ty) * gen.width + (c.x + tx)) * 4;
            gen.bitmap[gi] = src.bitmap[si];
            gen.bitmap[gi + 1] = src.bitmap[si + 1];
            gen.bitmap[gi + 2] = src.bitmap[si + 2];
            gen.bitmap[gi + 3] = 255;
          }
        }
      }
    }
    report.push(entry);
  }

  return { png: await gen.encode(), report };
}

/** Count slot-coloured pixels left in a composited image. The spike showed the
 * model sometimes INVENTS an extra slot (it drew a second product card as a
 * magenta rectangle); no photo maps to it, so it survives the restore as raw
 * magenta. Any visible remainder means the image is unusable, and unlike every
 * other defect this one is detectable by arithmetic instead of a vision judge. */
export async function leftoverSlotPixels(compositedPng: Uint8Array): Promise<number> {
  const img = await Image.decode(compositedPng);
  let n = 0;
  for (let i = 0; i < img.bitmap.length; i += 4) {
    if (isSlotColour(img.bitmap, i)) n++;
  }
  return n;
}

/** The paragraph appended to the production prompt when the source has been
 * masked. Kept here so the spike and the real path can never drift apart. */
export function lockSlotsPrompt(count: number): string {
  return [
    `LOCKED IMAGE SLOTS: the source screenshot contains ${count} solid magenta rectangle(s). Each one is a LOCKED placeholder standing in for a real photograph that will be pasted back in afterwards by software.`,
    `Treat every magenta rectangle as an immovable photo that you cannot see. Carry each one through to your output as the SAME clean, solid, pure magenta rectangle: same proportions, same place in the layout (it may shift slightly if a fix moves content around it).`,
    `NEVER draw anything inside a magenta rectangle, never tint it, never delete one, never split or merge them, and never add a new one. Your output must contain exactly ${count} solid magenta rectangle(s).`,
  ].join(" ");
}
