import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";

// Pull companies from HubSpot and create/link clients. Runs on a pg_cron
// schedule (authorized via x-cron-secret) and on demand from Settings
// (authorized via staff JWT). First run backfills existing companies in
// pages; later runs pick up companies created since the last sync.

const HUBSPOT_BASE = "https://api.hubapi.com";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 5; // up to 500 companies per run; backfill resumes via cursor
const OVERLAP_MS = 10 * 60 * 1000; // re-scan overlap; hubspot_company_id keeps it idempotent

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

type HubSpotCompany = {
  id: string;
  properties: {
    name?: string | null;
    domain?: string | null;
    website?: string | null;
    industry?: string | null;
    createdate?: string | null;
  };
};

async function hubspotFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg = parsed?.message ?? `HubSpot request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return parsed;
}

function normalizeDomain(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/** HubSpot industries look like "COMPUTER_SOFTWARE"; make them readable. */
function humanizeIndustry(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const sb = assertServiceRoleClient();

  // --- Authorize: staff JWT (manual sync) or the cron shared secret ---------
  let authorized = false;
  const cronSecret = (req.headers.get("x-cron-secret") ?? "").trim();
  if (cronSecret) {
    const { data } = await sb.from("hubspot_cron_secret").select("secret").eq("id", "default").maybeSingle();
    authorized = Boolean(data?.secret) && data.secret === cronSecret;
  }
  if (!authorized) {
    try {
      await requireStaffUserId(req);
      authorized = true;
    } catch {
      /* fall through */
    }
  }
  if (!authorized) {
    return json({ ok: false, error: { code: "unauthorized", message: "Not authorized" } }, { status: 200 });
  }

  const runStarted = new Date();

  const saveResult = async (result: Record<string, unknown>, patch: Record<string, unknown> = {}) => {
    await sb
      .from("hubspot_sync_state")
      .update({ last_result: { ...result, at: runStarted.toISOString() }, updated_at: new Date().toISOString(), ...patch })
      .eq("id", "default");
  };

  try {
    let token: string;
    try {
      token = await getSecret("hubspot_private_app_token");
    } catch {
      return json(
        { ok: false, error: { code: "not_configured", message: "HubSpot token is not configured. Add it in Settings." } },
        { status: 200 },
      );
    }

    const { data: state } = await sb
      .from("hubspot_sync_state")
      .select("last_synced_at, backfill_cursor")
      .eq("id", "default")
      .maybeSingle();

    const isFirstRun = !state?.last_synced_at;
    const backfilling = isFirstRun || Boolean(state?.backfill_cursor);

    // --- Fetch companies ----------------------------------------------------
    const companies: HubSpotCompany[] = [];
    let nextCursor: string | null = null;
    const propParams = "properties=name&properties=domain&properties=website&properties=industry&properties=createdate";

    if (backfilling) {
      let after: string | undefined = state?.backfill_cursor ?? undefined;
      for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
        const res = await hubspotFetch(
          token,
          `/crm/v3/objects/companies?limit=${PAGE_SIZE}&archived=false&${propParams}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        );
        companies.push(...((res?.results ?? []) as HubSpotCompany[]));
        after = res?.paging?.next?.after;
        if (!after) break;
      }
      nextCursor = after ?? null;
    } else {
      const sinceMs = new Date(state!.last_synced_at as string).getTime() - OVERLAP_MS;
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
        const res = await hubspotFetch(token, `/crm/v3/objects/companies/search`, {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [
              { filters: [{ propertyName: "createdate", operator: "GTE", value: String(sinceMs) }] },
            ],
            sorts: [{ propertyName: "createdate", direction: "ASCENDING" }],
            properties: ["name", "domain", "website", "industry", "createdate"],
            limit: PAGE_SIZE,
            ...(after ? { after } : {}),
          }),
        });
        companies.push(...((res?.results ?? []) as HubSpotCompany[]));
        after = res?.paging?.next?.after;
        if (!after) break;
      }
    }

    // --- Dedupe against existing clients ------------------------------------
    const { data: existingClients, error: clientsErr } = await sb
      .from("clients")
      .select("id, company_name, website_url, hubspot_company_id");
    if (clientsErr) throw clientsErr;

    const byHubspotId = new Set<string>();
    const byName = new Map<string, string>();
    const byDomain = new Map<string, string>();
    for (const c of existingClients ?? []) {
      if (c.hubspot_company_id) byHubspotId.add(c.hubspot_company_id);
      if (c.company_name) byName.set(c.company_name.trim().toLowerCase(), c.id);
      const d = normalizeDomain(c.website_url);
      if (d) byDomain.set(d, c.id);
    }

    let skipped = 0;
    let linked = 0;
    const toCreate: HubSpotCompany[] = [];

    for (const company of companies) {
      if (byHubspotId.has(company.id)) {
        skipped++;
        continue;
      }
      const nameKey = (company.properties.name ?? "").trim().toLowerCase();
      const domainKey = normalizeDomain(company.properties.domain ?? company.properties.website);
      const matchId = (nameKey && byName.get(nameKey)) || (domainKey && byDomain.get(domainKey)) || null;
      if (matchId) {
        // Existing client: just link it so future runs skip it.
        await sb.from("clients").update({ hubspot_company_id: company.id }).eq("id", matchId).is("hubspot_company_id", null);
        byHubspotId.add(company.id);
        linked++;
        continue;
      }
      if (nameKey) toCreate.push(company);
      else skipped++; // company with no name is not useful as a client
    }

    // --- Pull the primary contact for each new company ----------------------
    const contactIdByCompany = new Map<string, string>();
    for (const company of toCreate) {
      try {
        const assoc = await hubspotFetch(token, `/crm/v4/objects/companies/${company.id}/associations/contacts?limit=1`);
        const contactId = assoc?.results?.[0]?.toObjectId;
        if (contactId) contactIdByCompany.set(company.id, String(contactId));
      } catch {
        // Association lookup is best effort; the client is still created.
      }
    }

    const contactById = new Map<string, { name: string; email: string }>();
    const contactIds = [...new Set(contactIdByCompany.values())];
    if (contactIds.length > 0) {
      try {
        const batch = await hubspotFetch(token, `/crm/v3/objects/contacts/batch/read`, {
          method: "POST",
          body: JSON.stringify({
            properties: ["firstname", "lastname", "email"],
            inputs: contactIds.map((id) => ({ id })),
          }),
        });
        for (const c of batch?.results ?? []) {
          const name = [c?.properties?.firstname, c?.properties?.lastname].filter(Boolean).join(" ").trim();
          contactById.set(String(c.id), { name, email: (c?.properties?.email ?? "").trim() });
        }
      } catch {
        // Best effort; clients are still created without contact details.
      }
    }

    // --- Create clients ------------------------------------------------------
    let created = 0;
    for (const company of toCreate) {
      const contactId = contactIdByCompany.get(company.id);
      const contact = contactId ? contactById.get(contactId) : undefined;
      const domain = normalizeDomain(company.properties.domain ?? company.properties.website);
      const { error: insertErr } = await sb.from("clients").insert({
        company_name: (company.properties.name ?? "").trim(),
        name: contact?.name ?? "",
        email: contact?.email ?? "",
        website_url: domain ? `https://${domain}` : "",
        industry: humanizeIndustry(company.properties.industry),
        esp_platform: "Klaviyo",
        api_key_placeholder: "",
        notes: "Imported from HubSpot",
        hubspot_company_id: company.id,
      });
      if (insertErr) {
        // Unique-index conflicts (parallel runs) are fine; count everything else.
        if (!/duplicate key/i.test(insertErr.message ?? "")) throw insertErr;
        skipped++;
      } else {
        created++;
      }
    }

    // --- Save state -----------------------------------------------------------
    const result = {
      ok: true,
      mode: backfilling ? "backfill" : "incremental",
      scanned: companies.length,
      created,
      linked,
      skipped,
      backfill_remaining: Boolean(nextCursor),
    };
    await saveResult(result, {
      backfill_cursor: nextCursor,
      // Stamp the connect time on the first run so incremental sync picks up
      // from there once the backfill finishes paging.
      ...(isFirstRun || !backfilling ? { last_synced_at: runStarted.toISOString() } : {}),
    });

    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    const status = (e as { status?: number })?.status;
    const code = status === 401 || status === 403 ? "bad_token" : "sync_failed";
    await saveResult({ ok: false, error: { code, message } }).catch(() => {});
    return json({ ok: false, error: { code, message } }, { status: 200 });
  }
});
