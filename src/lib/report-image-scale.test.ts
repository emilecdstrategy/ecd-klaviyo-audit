/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_SCALE,
  MAX_IMAGE_SCALE,
  MIN_IMAGE_SCALE,
  normalizeImageScale,
} from './report-image-scale';

describe('normalizeImageScale', () => {
  it('returns default for nullish values', () => {
    expect(normalizeImageScale()).toBe(DEFAULT_IMAGE_SCALE);
    expect(normalizeImageScale(null)).toBe(DEFAULT_IMAGE_SCALE);
  });

  it('clamps to min and max', () => {
    expect(normalizeImageScale(0.05)).toBe(MIN_IMAGE_SCALE);
    expect(normalizeImageScale(2)).toBe(MAX_IMAGE_SCALE);
    expect(normalizeImageScale(0.5)).toBe(0.5);
  });
});
