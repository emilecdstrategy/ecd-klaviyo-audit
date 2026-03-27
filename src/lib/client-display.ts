import type { Client } from './types';

/** Hostname-style label for URLs (for compact UI lines). */
export function formatClientWebsiteLabel(url: string | null | undefined): string {
  const u = (url ?? '').trim();
  if (!u) return 'No website on file';
  try {
    const parsed = new URL(u.includes('://') ? u : `https://${u}`);
    const host = parsed.hostname.replace(/^www\./, '');
    return host || u;
  } catch {
    return u;
  }
}

export function formatClientAddedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** One line for selects / search rows: website + created date. */
export function formatClientListMeta(client: Pick<Client, 'website_url' | 'created_at'>): string {
  const site = formatClientWebsiteLabel(client.website_url);
  const d = formatClientAddedDate(client.created_at);
  if (d) return `${site} · Added ${d}`;
  return site;
}
