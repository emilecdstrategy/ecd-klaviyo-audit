export function faviconUrlFromWebsite(websiteUrl?: string | null, size = 32): string | null {
  if (!websiteUrl?.trim()) return null;
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const hostname = new URL(url).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
  } catch {
    return null;
  }
}
