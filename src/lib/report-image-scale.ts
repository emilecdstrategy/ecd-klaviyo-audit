export const DEFAULT_IMAGE_SCALE = 1;
export const MIN_IMAGE_SCALE = 0.2;
export const MAX_IMAGE_SCALE = 1;

/** The attribution model screenshot is usually a tall settings panel, so it
 * reads better at half width by default. Still fully resizable afterwards. */
export const ATTRIBUTION_DEFAULT_SCALE = 0.5;

export function normalizeImageScale(scale?: number | null): number {
  if (scale == null || !Number.isFinite(scale)) return DEFAULT_IMAGE_SCALE;
  return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
}
