export const DEFAULT_IMAGE_SCALE = 1;
export const MIN_IMAGE_SCALE = 0.2;
export const MAX_IMAGE_SCALE = 1;

export function normalizeImageScale(scale?: number | null): number {
  if (scale == null || !Number.isFinite(scale)) return DEFAULT_IMAGE_SCALE;
  return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
}
