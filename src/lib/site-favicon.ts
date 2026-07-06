export function websiteHostname(websiteUrl?: string | null): string | null {
  if (!websiteUrl?.trim()) return null;
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname || null;
  } catch {
    return null;
  }
}

/** Canonical https origin used when persisting client website URLs. */
export function normalizeClientWebsiteUrl(raw?: string | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Prefer an explicit client URL, then a Klaviyo-synced override when present. */
export function resolveClientWebsiteUrl(
  client?: { website_url?: string | null } | null,
  override?: string | null,
): string | null {
  return normalizeClientWebsiteUrl(override) ?? normalizeClientWebsiteUrl(client?.website_url) ?? null;
}

export function faviconUrlFromWebsite(websiteUrl?: string | null, size = 32): string | null {
  const hostname = websiteHostname(websiteUrl);
  if (!hostname) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
}

export function faviconFallbackUrlFromWebsite(websiteUrl?: string | null): string | null {
  const hostname = websiteHostname(websiteUrl);
  if (!hostname) return null;
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;
}

