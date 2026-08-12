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
export type PhotoBox = {
  x: number; y: number; w: number; h: number; src?: string;
  /** Present on TEXT locks: what kind of must-not-change text this box holds
   * ("title" | "price" | "rating" | "logo"). Photos leave it unset. The
   * mask/restore pipeline treats both identically; kind exists for the prepare
   * step (fix-targeting, sizing) and for diagnosability. */
  kind?: string;
  /** The locked text itself, so a lock can be skipped when a fix explicitly
   * targets that copy. */
  text?: string;
};

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
  /** How the restore was done: a clean rectangle paste, or pixel-wise when the
   * model drew a text overlay over the slot (hero titles), where only the
   * slot-coloured pixels are replaced so the drawn overlay survives on top of
   * the restored photo. */
  mode?: "rect" | "pixelwise";
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
): Promise<{ png: Uint8Array; report: SlotReport[]; leftoverPx: number }> {
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
      // Shape compatibility: matching by distance alone pasted a wide BANNER
      // photo into a square product-card slot when the model rearranged the
      // page. A slot standing in for a photo keeps roughly its proportions and
      // scale, so a candidate whose aspect or area is far off is not that slot.
      const aspectDrift = (c.w / c.h) / (e.w / e.h);
      const areaDrift = (c.w * c.h) / (e.w * e.h);
      // Text slots get a tighter gate than photos: their paste STRETCHES the
      // source pixels to the found rect (see below), and a stretch beyond
      // ~1.5x makes the client's own typography look wrong, which is exactly
      // the impression the lock exists to prevent. Better to reject and retry.
      const isText = !!photos[pi].kind;
      if (isText) {
        if (aspectDrift < 0.65 || aspectDrift > 1.55) continue;
        if (areaDrift < 0.4 || areaDrift > 2.5) continue;
      } else {
        if (aspectDrift < 0.45 || aspectDrift > 2.2) continue;
        if (areaDrift < 0.25 || areaDrift > 4) continue;
      }
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
    const entry: SlotReport = {
      index: pi,
      src: photos[pi].src ?? (photos[pi].kind ? `${photos[pi].kind}: ${photos[pi].text ?? ""}`.trim() : undefined),
      expected: expected[pi],
      found: null,
      purity: 0,
    };
    const ci = slotByPhoto.get(pi);
    if (ci !== undefined) {
      const c = components[ci];
      entry.purity = c.purity;
      // Purity of a clean solid rectangle is ~1 (spike runs measured 0.996 to
      // 1.0). Meaningfully below that means the model drew INTO the slot
      // (glyphs over the rectangle scored ~0.85-0.92 on a live run and pasting
      // erased them halfway, leaving clipped text remnants), so demand a clean
      // rectangle and let the caller regenerate instead.
      // 0.5 instead of demanding near-1: a slot with a title drawn into it (the
      // model re-adds a hero heading over the banner, as the real design has)
      // scores 0.5-0.95. Pasting the source rect over it is right: the source
      // pixels carry the page's own baked-in overlay text. A pixel-wise variant
      // that tried to keep the model's drawn title was worse in practice: the
      // glyphs blend into the magenta, so they came back with pink fringing.
      if (c.purity >= 0.5) {
        // Dilate the paste rect a couple of pixels: the model re-encodes the
        // image, so the slot has a thin blended halo just outside the pure
        // bounding box, and it showed up as a 1px magenta outline in the first
        // published composite.
        const D = 3;
        const px0 = Math.max(0, c.x - D), py0 = Math.max(0, c.y - D);
        const pw = Math.min(gen.width - px0, c.w + 2 * D);
        const ph = Math.min(gen.height - py0, c.h + 2 * D);
        entry.found = { x: px0, y: py0, w: pw, h: ph };
        entry.mode = "rect";
        // COVER-fit, anchored to the TOP of the source region: scale the source
        // photo to fill the slot while keeping its aspect ratio. Top-anchored
        // because a slot that came back shorter almost always means a fix asked
        // to trim the banner, and "trim" means the window got shorter, not that
        // the view re-centred; hero banners also carry their headline overlay in
        // the upper part of the source pixels, which a centre crop cut off.
        // Text slots STRETCH instead: cover-fit crops pixels, and cropping a
        // title slices glyphs off its edges (a live spike lost the leading
        // "'Si" of a product name to a 22% taller slot). A mild non-uniform
        // stretch keeps every glyph and the shape gate above caps how far the
        // stretch can go before the candidate is rejected outright.
        const isTextSlot = !!photos[pi].kind;
        const scale = Math.max(pw / srcBox.w, ph / srcBox.h);
        const cropW = isTextSlot ? srcBox.w : Math.min(srcBox.w, Math.round(pw / scale));
        const cropH = isTextSlot ? srcBox.h : Math.min(srcBox.h, Math.round(ph / scale));
        const cropX = isTextSlot ? srcBox.x : srcBox.x + ((srcBox.w - cropW) >> 1);
        const cropY = srcBox.y;
        for (let ty = 0; ty < ph; ty++) {
          const sy = cropY + Math.min(cropH - 1, Math.floor((ty / ph) * cropH));
          for (let tx = 0; tx < pw; tx++) {
            const sx = cropX + Math.min(cropW - 1, Math.floor((tx / pw) * cropW));
            const si = (sy * src.width + sx) * 4;
            const gi = ((py0 + ty) * gen.width + (px0 + tx)) * 4;
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

  defringe(gen);
  // Count remaining slot pixels on the in-memory bitmap: re-decoding the
  // encoded 2K PNG just to count (the old leftoverSlotPixels round trip) was
  // one full decode too many for the edge function's compute budget.
  let leftoverPx = 0;
  for (let i = 0; i < gen.bitmap.length; i += 4) {
    if (isSlotColour(gen.bitmap, i)) leftoverPx++;
  }
  return { png: await gen.encode(), report, leftoverPx };
}

/** Clean up thin magenta remnants: anti-aliased slot borders and glyphs the
 * model blended into a slot leave pinkish fringes that survive the rect paste
 * (they sit outside any component's bounding box, e.g. a breadcrumb drawn over
 * the slot's top sliver). A fringe pixel is replaced by a nearby non-magenta
 * neighbour. Deliberately only fixes THIN features: a pixel deep inside a solid
 * magenta block has no clean neighbour in reach and stays magenta, so a
 * destroyed or invented slot still trips the leftover gate afterwards. */
function defringe(img: Image): void {
  const w = img.width, h = img.height;
  const b = img.bitmap;
  // Wider net than the slot test: catches half-blended pink, not just pure.
  const fringey = (i: number) => b[i] >= 140 && b[i + 2] >= 120 && b[i + 1] <= 120 && (b[i] - b[i + 1]) >= 60 && (b[i + 2] - b[i + 1]) >= 40;
  const hits: number[] = [];
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    if (fringey(i)) hits.push(i);
  }
  for (const i of hits) {
    const p = i >> 2;
    const x = p % w, y = (p / w) | 0;
    // Nearest clean pixel within 3px, scanning outward.
    let done = false;
    for (let r = 1; r <= 3 && !done; r++) {
      for (const [dx, dy] of [[0, -r], [0, r], [-r, 0], [r, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        if (fringey(ni)) continue;
        b[i] = b[ni];
        b[i + 1] = b[ni + 1];
        b[i + 2] = b[ni + 2];
        done = true;
        break;
      }
    }
  }
}

/** Aspect ratios the Gemini image API accepts, as height/width values. The
 * model can ONLY output these shapes: asking for anything else means it
 * free-picks, letterboxes, or crops on its own, which is where the unreadable
 * text, blank bottom halves, and sliced banners came from. */
const SUPPORTED_RATIOS: Array<{ label: string; hw: number }> = [
  { label: "21:9", hw: 9 / 21 },
  { label: "16:9", hw: 9 / 16 },
  { label: "3:2", hw: 2 / 3 },
  { label: "4:3", hw: 3 / 4 },
  { label: "5:4", hw: 4 / 5 },
  { label: "1:1", hw: 1 },
  { label: "4:5", hw: 5 / 4 },
  { label: "3:4", hw: 4 / 3 },
  { label: "2:3", hw: 3 / 2 },
  { label: "9:16", hw: 16 / 9 },
];

/** Crop a screenshot, top-anchored, to the tallest supported ratio that fits
 * inside it, so the model can output EXACTLY the input's shape. Returns the
 * cropped PNG, the ratio label to request, and rescaled photo boxes (photos
 * fully below the crop are dropped; ones straddling the edge are clipped).
 * A screenshot already within 2% of a supported ratio is passed through. */
export async function cropToSupportedRatio(
  sourcePng: Uint8Array,
  photos: PhotoBox[],
): Promise<{ png: Uint8Array; ratio: string; photos: PhotoBox[]; cropped: boolean }> {
  const img = await Image.decode(sourcePng);
  const hw = img.height / img.width;
  // Tallest ratio that is NOT taller than the source: cropping the bottom keeps
  // the first fold, which is where nearly every fix lives; padding would hand
  // the model empty space to fill with inventions.
  let best = SUPPORTED_RATIOS[0];
  for (const r of SUPPORTED_RATIOS) {
    if (r.hw <= hw + 0.02 && r.hw > best.hw) best = r;
  }
  if (Math.abs(best.hw - hw) / hw <= 0.02) {
    return { png: sourcePng, ratio: best.label, photos, cropped: false };
  }
  const newH = Math.round(img.width * best.hw);
  // In-place crop: a clone doubled the resident bitmap and helped push the
  // edge function over its compute limit at 2K.
  const cropped = img.crop(0, 0, img.width, newH);
  const scale = img.height / newH; // old % of full height -> % of cropped height
  const keptPhotos: PhotoBox[] = [];
  for (const p of photos) {
    const y = p.y * scale;
    if (y >= 99) continue; // entirely below the crop
    const h = Math.min(100 - y, p.h * scale);
    if (h < 2) continue;
    keptPhotos.push({ ...p, y: +y.toFixed(2), h: +h.toFixed(2) });
  }
  return { png: await cropped.encode(), ratio: best.label, photos: keptPhotos, cropped: true };
}

/** Force a generated image to the source's exact pixel dimensions.
 *
 * Exists because the two protections were fighting each other. Requesting an
 * explicit aspectRatio/imageSize makes Gemini RE-RENDER the page instead of
 * editing the input, which wiped the magenta lock slots every time (measured:
 * purity 0.997 without imageConfig, 0.0 with it, same page and prompt). So the
 * masked pass now asks for no shape at all and the shape is imposed here, in
 * code, where it is exact and free.
 *
 * Aspect differences are absorbed by scaling to cover and centre-cropping the
 * overflow, which is the same rule the slot restore uses, so a slightly
 * differently-shaped generation loses a sliver of margin rather than being
 * squashed. */
export async function conformToSize(
  png: Uint8Array,
  target: { w: number; h: number },
): Promise<Uint8Array> {
  const img = await Image.decode(png);
  if (img.width === target.w && img.height === target.h) return png;
  const scale = Math.max(target.w / img.width, target.h / img.height);
  const scaledW = Math.max(target.w, Math.round(img.width * scale));
  const scaledH = Math.max(target.h, Math.round(img.height * scale));
  const resized = img.resize(scaledW, scaledH);
  const cropX = Math.max(0, (scaledW - target.w) >> 1);
  const cropY = Math.max(0, (scaledH - target.h) >> 1);
  return await resized.crop(cropX, cropY, target.w, target.h).encode();
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
export function lockSlotsPrompt(count: number, textCount = 0): string {
  return [
    `LOCKED SLOTS: the source screenshot contains ${count} solid magenta rectangle(s). Each one is a LOCKED placeholder standing in for real content that will be pasted back in afterwards by software.`,
    textCount > 0
      ? `${textCount} of them hold text the store owns (a product title, a price or total, a review count, or the brand mark); the rest hold photographs. The rules are identical for both. NEVER write the locked text yourself: even when you can guess what a rectangle contains (a breadcrumb may repeat the product title), do NOT type it out and do NOT shrink the rectangle to make room for your own text. Leave the rectangle solid magenta at its full original size; software will place the exact text in the store's own typography. A slot replaced by your own typed text counts as a deleted slot and fails the task.`
      : `Each one stands in for a real photograph.`,
    `Treat every magenta rectangle as immovable content that you cannot see. Carry each one through to your output as the SAME clean, solid, pure magenta rectangle: same proportions, same place in the layout (it may shift slightly if a fix moves content around it).`,
    `NEVER draw anything inside a magenta rectangle, never tint it, never delete one, never split or merge them, and never add a new one. Your output must contain exactly ${count} solid magenta rectangle(s).`,
    `The magenta colour is RESERVED for those slots alone: never use magenta, pink, or violet as a fill, bar, band, button, or accent anywhere else in the design. Any pink element that is not one of the ${count} locked slots makes the output unusable.`,
  ].join(" ");
}

/** Prepare the combined lock list for one generation.
 *
 * Text boxes need three treatments photos never did:
 *  - EXPANSION: a price is ~60x18px; the slot finder's minimums and the model's
 *    willingness to preserve a rectangle both fail at that size, so every text
 *    lock grows to a survivable minimum. Growth is harmless: the restore pastes
 *    the source pixels of the SAME expanded region, so the extra margin comes
 *    back as the original whitespace it was.
 *  - FIX-TARGETING: a fix that quotes the locked text wants to CHANGE it
 *    ("rename the Shop Now button"); locking it would make the fix impossible,
 *    so that lock is dropped and the text stays editable (the text-integrity
 *    verifier still watches it).
 *  - OVERLAP MERGE: expanded neighbours (price beside compare-at price, tagline
 *    under a logo photo) would otherwise fuse into one magenta blob that the
 *    finder counts as one component against two expected slots and rejects the
 *    candidate. Overlapping locks merge into their union up front, photos
 *    included, so the mask and the expectation always agree.
 */
export function prepareLockBoxes(params: {
  photos: PhotoBox[];
  textLocks: PhotoBox[];
  recommendations: string[];
  dims: { w: number; h: number };
}): PhotoBox[] {
  const { photos, textLocks, recommendations, dims } = params;
  const recsLower = recommendations.map((r) => r.toLowerCase());
  const fixTargets = (t?: string) => {
    if (!t) return false;
    const needle = t.toLowerCase().trim();
    // Very short strings ("$5") match too easily; keep those locked.
    if (needle.length < 5) return false;
    return recsLower.some((r) => r.includes(needle));
  };

  const MIN_W = 52, MIN_H = 30, PAD = 4;
  const expanded: PhotoBox[] = [];
  for (const t of textLocks) {
    if (fixTargets(t.text)) continue;
    let x = (t.x / 100) * dims.w - PAD;
    let y = (t.y / 100) * dims.h - PAD;
    let w = (t.w / 100) * dims.w + PAD * 2;
    let h = (t.h / 100) * dims.h + PAD * 2;
    if (w < MIN_W) { x -= (MIN_W - w) / 2; w = MIN_W; }
    if (h < MIN_H) { y -= (MIN_H - h) / 2; h = MIN_H; }
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.min(dims.w - x, w);
    h = Math.min(dims.h - y, h);
    expanded.push({
      ...t,
      x: +((x / dims.w) * 100).toFixed(2),
      y: +((y / dims.h) * 100).toFixed(2),
      w: +((w / dims.w) * 100).toFixed(2),
      h: +((h / dims.h) * 100).toFixed(2),
    });
  }

  // Union any two locks whose overlap covers most of the smaller one, until
  // stable. O(n^2) over at most a few dozen boxes.
  const merged: PhotoBox[] = [...photos, ...expanded];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const inter = ix * iy;
        if (inter <= 0) continue;
        const smaller = Math.min(a.w * a.h, b.w * b.h);
        if (inter < smaller * 0.4) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const union: PhotoBox = {
          x,
          y,
          w: Math.max(a.x + a.w, b.x + b.w) - x,
          h: Math.max(a.y + a.h, b.y + b.h) - y,
          src: a.src ?? b.src,
          kind: a.kind && b.kind ? a.kind : a.kind ?? b.kind,
          text: [a.text, b.text].filter(Boolean).join(" | ") || undefined,
        };
        merged.splice(j, 1);
        merged.splice(i, 1, union);
        changed = true;
        break outer;
      }
    }
  }
  return merged;
}
