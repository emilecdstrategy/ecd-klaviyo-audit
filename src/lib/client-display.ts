import type { Client } from './types';

/** Normalized key for matching / deduping clients by company name. */
export function normalizeCompanyKey(companyName: string | null | undefined): string {
  return (companyName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function auditCountForClient(clientId: string, auditCountByClient: Map<string, number>): number {
  return auditCountByClient.get(clientId) ?? 0;
}

function pickCanonicalClient(a: Client, b: Client, auditCountByClient: Map<string, number>): Client {
  const aAudits = auditCountForClient(a.id, auditCountByClient);
  const bAudits = auditCountForClient(b.id, auditCountByClient);
  if (aAudits !== bAudits) return aAudits > bAudits ? a : b;

  const aConnected = Boolean((a as Client & { klaviyo_connected?: boolean }).klaviyo_connected);
  const bConnected = Boolean((b as Client & { klaviyo_connected?: boolean }).klaviyo_connected);
  if (aConnected !== bConnected) return aConnected ? a : b;

  return new Date(a.created_at).getTime() <= new Date(b.created_at).getTime() ? a : b;
}

/** One row per company name — keeps the client with audits / Klaviyo connection / earliest created. */
export function dedupeClientsByCompany(
  clients: Client[],
  auditCountByClient: Map<string, number> = new Map(),
): Client[] {
  const byKey = new Map<string, Client>();
  for (const client of clients) {
    const key = normalizeCompanyKey(client.company_name || client.name);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? pickCanonicalClient(existing, client, auditCountByClient) : client);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

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
