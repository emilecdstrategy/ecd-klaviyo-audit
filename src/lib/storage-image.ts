/**
 * Screenshot URLs, resized and recompressed on the way to the browser.
 *
 * The capture stores viewport screenshots as PNGs of 0.4 to 1.3MB each, and a
 * web report renders up to eight of them (four pages, two devices, all warmed
 * up front). Serving them through Supabase's image proxy instead of the raw
 * object turns each into a ~150KB WebP: measured on a live report's shots,
 * 1,262,661 bytes became 152,880 at width 1400 and quality 80, an 88% cut,
 * with the three others in the same range.
 *
 * Width 1400 is not a compromise: desktop shots are captured at 1440px and
 * mobile at 780px, so nothing is ever meaningfully downscaled, including the
 * finding crop cards that zoom into regions of the same image.
 *
 * Only rewrites OUR storage's public-object URLs. Anything else (Shopify CDN
 * product photos, data URIs, null) passes through untouched. Callers should
 * keep the original URL on hand as an onError fallback so a proxy hiccup
 * degrades to the slow image rather than a broken one.
 */
const PUBLIC_OBJECT_SEGMENT = '/storage/v1/object/public/';
const RENDER_SEGMENT = '/storage/v1/render/image/public/';

export function optimizedStorageImage(
  url: string | null | undefined,
  width = 1400,
  quality = 80,
): string {
  const raw = (url ?? '').trim();
  if (!raw || !raw.includes(PUBLIC_OBJECT_SEGMENT)) return raw;
  const rewritten = raw.replace(PUBLIC_OBJECT_SEGMENT, RENDER_SEGMENT);
  const sep = rewritten.includes('?') ? '&' : '?';
  return `${rewritten}${sep}width=${width}&quality=${quality}`;
}
