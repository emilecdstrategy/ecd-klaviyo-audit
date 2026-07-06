/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  faviconUrlFromWebsite,
  normalizeClientWebsiteUrl,
  resolveClientWebsiteUrl,
  websiteHostname,
} from './site-favicon';

describe('normalizeClientWebsiteUrl', () => {
  it('normalizes bare domains to https origins', () => {
    expect(normalizeClientWebsiteUrl('lazyleaf.com')).toBe('https://lazyleaf.com');
    expect(normalizeClientWebsiteUrl(' www.lazyleaf.com/ ')).toBe('https://www.lazyleaf.com');
  });

  it('returns null for empty or invalid values', () => {
    expect(normalizeClientWebsiteUrl('')).toBeNull();
    expect(normalizeClientWebsiteUrl('   ')).toBeNull();
    expect(normalizeClientWebsiteUrl('not a url!!!')).toBeNull();
  });
});

describe('resolveClientWebsiteUrl', () => {
  it('prefers override when present', () => {
    expect(resolveClientWebsiteUrl({ website_url: 'https://old.com' }, 'new.com')).toBe('https://new.com');
  });

  it('falls back to client website', () => {
    expect(resolveClientWebsiteUrl({ website_url: 'lazyleaf.com' })).toBe('https://lazyleaf.com');
  });
});

describe('faviconUrlFromWebsite', () => {
  it('builds a google favicon URL from stored website values', () => {
    expect(faviconUrlFromWebsite('https://lazyleaf.com')).toContain('lazyleaf.com');
    expect(websiteHostname('lazyleaf.com')).toBe('lazyleaf.com');
  });
});
