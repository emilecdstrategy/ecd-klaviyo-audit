import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type FetchInput = {
  audit_id: string;
  client_id: string;
  api_key?: string; // optional if already stored
  revision?: string; // optional override
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Secret used to encrypt/decrypt Klaviyo keys stored in DB.
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

const KLAVIYO_BASE = "https://a.klaviyo.com";
const DEFAULT_REVISION = "2024-10-15";
const MAX_REPORT_IDS = 50;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

function redactSecrets(msg: string) {
  return msg.replace(/pk_[a-zA-Z0-9_\\-]+/g, "pk_[REDACTED]");
}

function assertServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing Authorization header");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Invalid session");
  return data.user;
}

function b64encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function b64decode(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(secret: string) {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encryptionSecret() {
  return (KMS_ENCRYPTION_KEY || SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

async function encryptString(plaintext: string) {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Encryption secret is missing");
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return {
    alg: "AES-256-GCM",
    ciphertext: b64encode(new Uint8Array(ct)),
    iv: b64encode(iv),
  };
}

async function decryptString(ciphertextB64: string, ivB64: string) {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Encryption secret is missing");
  const key = await deriveAesKey(secret);
  const iv = b64decode(ivB64);
  const ct = b64decode(ciphertextB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function klaviyoFetch(apiKey: string, revision: string, path: string) {
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Klaviyo-API-Key ${apiKey}`,
      revision,
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function fetchWithRetry(fn: () => Promise<{ ok: boolean; status: number; body: any }>, attempts = 3) {
  let last: any = null;
  for (let i = 1; i <= attempts; i++) {
    const res = await fn();
    last = res;
    if (res.ok) return res;
    if (![429, 500, 502, 503, 504].includes(res.status)) return res;
    const delay = 400 * Math.pow(2, i - 1);
    await new Promise((r) => setTimeout(r, delay));
  }
  return last;
}

async function klaviyoPaged(apiKey: string, revision: string, path: string, maxPages = 10) {
  const out: any[] = [];
  let next = path;
  for (let i = 0; i < maxPages && next; i++) {
    const res = await fetchWithRetry(() => klaviyoFetch(apiKey, revision, next), 3);
    if (!res.ok) return { ok: false as const, status: res.status, body: res.body, items: out };
    const items = res.body?.data ?? [];
    out.push(...items);
    // JSON:API pagination uses links.next when available
    const nextUrl: string | null = res.body?.links?.next ?? null;
    if (!nextUrl) break;
    const u = new URL(nextUrl);
    next = `${u.pathname}${u.search}`;
  }
  return { ok: true as const, status: 200, items: out };
}

async function queryValuesReport(params: {
  apiKey: string;
  revision: string;
  endpointPath: "/api/campaign-values-reports/" | "/api/flow-values-reports/";
  timeframeKey: "last_30_days" | "last_90_days";
  conversionMetricId: string;
  filter?: string;
  statistics: string[];
  groupBy: string[];
}) {
  const res = await fetch(`${KLAVIYO_BASE}${params.endpointPath}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Klaviyo-API-Key ${params.apiKey}`,
      revision: params.revision,
    },
    body: JSON.stringify({
      data: {
        type: params.endpointPath.includes("campaign") ? "campaign-values-report" : "flow-values-report",
        attributes: {
          timeframe: { key: params.timeframeKey },
          conversion_metric_id: params.conversionMetricId,
          filter: params.filter,
          statistics: params.statistics,
          group_by: params.groupBy,
        },
      },
    }),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function retryAfterMsFromKlaviyo429(body: any): number | null {
  try {
    const detail = body?.errors?.[0]?.detail;
    if (typeof detail !== "string") return null;
    const m = detail.match(/expected available in\s+(\d+)\s+seconds/i);
    if (!m?.[1]) return null;
    const seconds = Number(m[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(60_000, Math.max(800, seconds * 1000));
  } catch {
    return null;
  }
}

async function queryValuesReportWithBackoff(params: Parameters<typeof queryValuesReport>[0]) {
  // Values reports are the most likely to throttle; do a gentle backoff on 429 only.
  let last: { ok: boolean; status: number; body: any } = { ok: false, status: 0, body: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await queryValuesReport(params);
    last = res;
    if (res.ok) return res;
    if (res.status !== 429) return res;
    const retryMs = retryAfterMsFromKlaviyo429(res.body) ?? (800 * attempt);
    await new Promise((r) => setTimeout(r, retryMs));
  }
  return last;
}

async function pickBestConversionMetricId(params: {
  apiKey: string;
  revision: string;
  candidateMetricIds: string[];
  flowIds: string[];
}) {
  const candidates = Array.from(new Set(params.candidateMetricIds.filter(Boolean)));
  for (const metricId of candidates) {
    const sampleFlowIds = params.flowIds.slice(0, 10);
    const filter = sampleFlowIds.length
      ? `contains-any(flow_id,[${sampleFlowIds.map((id) => JSON.stringify(id)).join(",")}])`
      : undefined;
    const probe = await fetchWithRetry(
      () =>
        queryValuesReportWithBackoff({
          apiKey: params.apiKey,
          revision: params.revision,
          endpointPath: "/api/flow-values-reports/",
          timeframeKey: "last_30_days",
          conversionMetricId: metricId,
          filter,
          statistics: ["recipients", "conversion_rate", "conversion_value", "revenue_per_recipient"],
          groupBy: ["flow_id", "send_channel"],
        }),
      2,
    );
    if (!probe.ok) continue;
    const rows = probe.body?.data?.attributes?.results ?? [];
    const hasConversionData = rows.some((r: any) => {
      const stats = r?.statistics ?? {};
      return Number(stats.conversion_value ?? 0) > 0 || Number(stats.conversion_uniques ?? 0) > 0;
    });
    if (hasConversionData) {
      return { metricId, reason: "probe_nonzero_conversion" as const };
    }
  }
  return { metricId: candidates[0] ?? null, reason: "fallback_first_candidate" as const };
}

async function klaviyoPostJson(apiKey: string, revision: string, path: string, body: unknown) {
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Klaviyo-API-Key ${apiKey}`,
      revision,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function trimBody(body: unknown, max = 500) {
  if (body == null) return null;
  if (typeof body === "string") return body.slice(0, max);
  try {
    return JSON.stringify(body).slice(0, max);
  } catch {
    return "unserializable";
  }
}

async function mustSucceed(label: string, p: Promise<{ error: any }>) {
  const { error } = await p;
  if (error) throw new Error(`${label} failed: ${error.message ?? "unknown error"}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  let auditId: string | null = null;
  let clientId: string | null = null;
  let revision: string | null = null;

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: { code: "config_missing", message: "Supabase env missing" }, correlationId }, { status: 500 });
    }

    try {
      await requireAuthenticatedUser(req);
    } catch (e) {
      return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
    }

    const input = (await req.json()) as FetchInput;
    auditId = input.audit_id;
    clientId = input.client_id;
    revision = (input.revision || DEFAULT_REVISION).trim();
    if (!auditId || !clientId) return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or client_id" }, correlationId }, { status: 400 });

    const sb = assertServiceClient();

    // Resolve API key: request-provided overrides stored.
    let apiKey = (input.api_key || "").trim();
    if (!apiKey) {
      const { data, error } = await sb.from("client_secrets").select("*").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      if (!data?.klaviyo_private_key_ciphertext || !data?.klaviyo_private_key_iv) {
        return json({ ok: false, error: { code: "missing_key", message: "No Klaviyo key stored for this client" }, correlationId }, { status: 400 });
      }
      apiKey = await decryptString(data.klaviyo_private_key_ciphertext, data.klaviyo_private_key_iv);
    } else {
      // Store/refresh encrypted key for the client
      const enc = await encryptString(apiKey);
      await mustSucceed("client_secrets upsert", sb.from("client_secrets").upsert({
        client_id: clientId,
        klaviyo_private_key_ciphertext: enc.ciphertext,
        klaviyo_private_key_iv: enc.iv,
        klaviyo_private_key_alg: enc.alg,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id" }));
    }

    // 1) Validate + account identity
    const accountRes = await fetchWithRetry(() => klaviyoFetch(apiKey, revision, "/api/accounts/"), 3);
    if (!accountRes.ok) {
      const detail =
        (accountRes.body as any)?.errors?.[0]?.detail ??
        (accountRes.body as any)?.error?.message ??
        null;
      return json(
        {
          ok: false,
          error: {
            code: "invalid_key_or_scope",
            status: accountRes.status,
            message: `Account lookup failed (${accountRes.status})${detail ? `: ${detail}` : ""}`,
          },
          correlationId,
        },
        { status: 200 },
      );
    }
    const account = accountRes.body?.data?.[0] ?? null;
    const accountId = account?.id ?? null;
    const accountName = account?.attributes?.contact_information?.organization_name ?? null;
    const websiteUrl = account?.attributes?.contact_information?.website_url ?? null;
    const timezone = account?.attributes?.timezone ?? null;
    const preferredCurrency = account?.attributes?.preferred_currency ?? null;

    // 2) Fetch configuration snapshots
    // Flows and forms support page[size]; campaigns, lists, and segments use
    // cursor-only pagination with fixed page sizes (do NOT pass page[size]).
    const [flows, lists, segments, forms, campaigns] = await Promise.all([
      klaviyoPaged(apiKey, revision, "/api/flows/?page%5Bsize%5D=50"),
      klaviyoPaged(apiKey, revision, "/api/lists/", 20),
      klaviyoPaged(apiKey, revision, "/api/segments/", 20),
      klaviyoPaged(apiKey, revision, "/api/forms/?page%5Bsize%5D=100"),
      klaviyoPaged(apiKey, revision, "/api/campaigns/?filter=equals(messages.channel,'email')", 20),
    ]);

    // 3) Persist snapshots (clear prior snapshots for this audit_id to keep latest)
    await mustSucceed("delete klaviyo_flow_snapshots", sb.from("klaviyo_flow_snapshots").delete().eq("audit_id", auditId));
    await mustSucceed("delete klaviyo_campaign_snapshots", sb.from("klaviyo_campaign_snapshots").delete().eq("audit_id", auditId));
    await mustSucceed("delete klaviyo_form_snapshots", sb.from("klaviyo_form_snapshots").delete().eq("audit_id", auditId));
    await mustSucceed("delete klaviyo_segment_snapshots", sb.from("klaviyo_segment_snapshots").delete().eq("audit_id", auditId));
    await mustSucceed("delete klaviyo_reporting_rollups", sb.from("klaviyo_reporting_rollups").delete().eq("audit_id", auditId));

    if (flows.ok) {
      const rows = flows.items.map((f: any) => ({
        audit_id: auditId,
        client_id: clientId,
        flow_id: f.id,
        name: f.attributes?.name ?? "",
        status: f.attributes?.status ?? "",
        trigger_type: f.attributes?.trigger_type ?? null,
        archived: f.attributes?.archived ?? null,
        created_at_klaviyo: f.attributes?.created ? new Date(f.attributes.created).toISOString() : null,
        updated_at_klaviyo: f.attributes?.updated ? new Date(f.attributes.updated).toISOString() : null,
        raw: f,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_flow_snapshots", sb.from("klaviyo_flow_snapshots").insert(rows));
    }

    if (campaigns.ok) {
      const rows = campaigns.items.map((c: any) => ({
        audit_id: auditId,
        client_id: clientId,
        campaign_id: c.id,
        name: c.attributes?.name ?? "",
        status: c.attributes?.status ?? "",
        send_channel: c.attributes?.send_channel ?? "email",
        created_at_klaviyo: c.attributes?.created_at ?? null,
        updated_at_klaviyo: c.attributes?.updated_at ?? null,
        raw: c,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_campaign_snapshots", sb.from("klaviyo_campaign_snapshots").insert(rows));
    }

    if (forms.ok) {
      const rows = forms.items.map((f: any) => ({
        audit_id: auditId,
        client_id: clientId,
        form_id: f.id,
        name: f.attributes?.name ?? "",
        status: f.attributes?.status ?? "",
        ab_test: f.attributes?.ab_test ?? null,
        created_at_klaviyo: f.attributes?.created_at ?? null,
        updated_at_klaviyo: f.attributes?.updated_at ?? null,
        raw: f,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_form_snapshots", sb.from("klaviyo_form_snapshots").insert(rows));
    }

    if (segments.ok) {
      const rows = segments.items.map((s: any) => ({
        audit_id: auditId,
        client_id: clientId,
        segment_id: s.id,
        name: s.attributes?.name ?? "",
        created_at_klaviyo: s.attributes?.created ?? null,
        updated_at_klaviyo: s.attributes?.updated ?? null,
        raw: s,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_segment_snapshots", sb.from("klaviyo_segment_snapshots").insert(rows));
    }

    // 4) Store connection metadata (with diagnostic info for failures)
    function extractKlaviyoError(res: any): string | null {
      if (res.ok) return null;
      const errs = res.body?.errors;
      if (Array.isArray(errs) && errs.length > 0) {
        return errs.map((e: any) => `${e.status ?? ""} ${e.title ?? ""}: ${e.detail ?? ""}`).join("; ").slice(0, 500);
      }
      if (typeof res.body === "string") return res.body.slice(0, 500);
      try { return JSON.stringify(res.body).slice(0, 500); } catch { return "unknown"; }
    }
    const scopeDiag: Record<string, any> = {};
    const resources = { accounts: accountRes, flows, lists, segments, forms, campaigns } as Record<string, any>;
    for (const [name, res] of Object.entries(resources)) {
      scopeDiag[name] = res.ok
        ? true
        : { ok: false, status: res.status ?? null, error: extractKlaviyoError(res) };
    }
    const scopes = scopeDiag;
    await mustSucceed("upsert klaviyo_connections", sb.from("klaviyo_connections").upsert({
      client_id: clientId,
      account_id: accountId,
      account_name: accountName,
      website_url: websiteUrl,
      timezone,
      preferred_currency: preferredCurrency,
      revision,
      scopes,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }));

    // Backfill client website if missing.
    if (websiteUrl) {
      const { data: existingClient } = await sb.from("clients").select("website_url").eq("id", clientId).maybeSingle();
      if (!existingClient?.website_url) {
        await mustSucceed("update clients.website_url", sb.from("clients").update({ website_url: websiteUrl }).eq("id", clientId));
      }
    }

    await mustSucceed("update clients.klaviyo_connected", sb.from("clients").update({ klaviyo_connected: true }).eq("id", clientId));

    // 5) Reporting rollups (values reports)
    // Reporting endpoints require conversion_metric_id. We'll attempt to resolve "Placed Order" metric id.
    // Metrics endpoint can reject page[size] on some revisions/accounts; use cursor pagination only.
    const metricsRes = await klaviyoPaged(apiKey, revision, "/api/metrics/", 5);
    const flowIdsForMetricProbe = flows.ok ? flows.items.map((f: any) => f.id) : [];
    const placedOrderCandidates = metricsRes.ok
      ? metricsRes.items
          .filter((m: any) => (m?.attributes?.name ?? "").toLowerCase().includes("placed order"))
          .map((m: any) => m.id)
      : [];
    const fallbackCandidates = metricsRes.ok ? metricsRes.items.map((m: any) => m.id).slice(0, 10) : [];
    const metricCandidates = placedOrderCandidates.length > 0 ? placedOrderCandidates : fallbackCandidates;
    const pickedMetric = metricsRes.ok
      ? await pickBestConversionMetricId({
          apiKey,
          revision,
          candidateMetricIds: metricCandidates,
          flowIds: flowIdsForMetricProbe,
        })
      : { metricId: null, reason: "metrics_fetch_failed" as const };
    const conversionMetricId = pickedMetric.metricId;

    const timeframeKeys: Array<"last_30_days" | "last_90_days"> = ["last_30_days", "last_90_days"];
    const reportStats = ["recipients", "open_rate", "click_rate", "conversion_rate", "conversion_value", "revenue_per_recipient"];
    const reportingErrors: Array<{ stage: string; status?: number | null; message: string }> = [];

    let campaignReports: any[] = [];
    let flowReports: any[] = [];
    await mustSucceed("delete flow_performance", sb.from("flow_performance").delete().eq("audit_id", auditId));

    if (!metricsRes.ok) {
      reportingErrors.push({
        stage: "metrics_lookup",
        status: metricsRes.status ?? null,
        message: trimBody(metricsRes.body) ?? "Metrics lookup failed",
      });
    } else if (!conversionMetricId) {
      reportingErrors.push({
        stage: "metrics_lookup",
        status: 200,
        message: "No conversion metric id available from /api/metrics",
      });
    }

    if (conversionMetricId) {
      // Campaign values: email only
      for (const tf of timeframeKeys) {
        const rep = await queryValuesReportWithBackoff({
          apiKey,
          revision,
          endpointPath: "/api/campaign-values-reports/",
          timeframeKey: tf,
          conversionMetricId,
          filter: "contains-any(send_channel,[\"email\"])",
          statistics: reportStats,
          groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
        });
        if (rep.ok) {
          campaignReports.push({ timeframe: tf, results: rep.body?.data?.attributes?.results ?? [] });
        } else {
          reportingErrors.push({
            stage: `campaign_values_${tf}`,
            status: rep.status ?? null,
            message: trimBody(rep.body) ?? "Campaign values report failed",
          });
        }
      }

      // Flow values: limit to first N flows to stay within rate limits and filter limits.
      const flowIds = flows.ok ? flows.items.map((f: any) => f.id).slice(0, MAX_REPORT_IDS) : [];
      const flowFilter = flowIds.length
        ? `contains-any(flow_id,[${flowIds.map((id) => JSON.stringify(id)).join(",")}])`
        : undefined;

      for (const tf of timeframeKeys) {
        const rep = await queryValuesReportWithBackoff({
          apiKey,
          revision,
          endpointPath: "/api/flow-values-reports/",
          timeframeKey: tf,
          conversionMetricId,
          filter: flowFilter,
          statistics: reportStats,
          groupBy: ["flow_id", "flow_message_id", "send_channel"],
        });
        if (rep.ok) {
          flowReports.push({ timeframe: tf, results: rep.body?.data?.attributes?.results ?? [] });
        } else {
          reportingErrors.push({
            stage: `flow_values_${tf}`,
            status: rep.status ?? null,
            message: trimBody(rep.body) ?? "Flow values report failed",
          });
        }
      }

      // Compute flow_performance rows (aggregate by flow_id)
      const flowAgg: Record<string, { recipients: number; open: number; click: number; conv: number; value: number; rpr: number }> = {};
      const last30 = flowReports.find((r) => r.timeframe === "last_30_days")?.results ?? [];
      for (const row of last30) {
        const gid = row?.groupings?.flow_id;
        if (!gid) continue;
        const stats = row?.statistics ?? {};
        const recipients = Number(stats.recipients ?? 0) || 0;
        const open_rate = Number(stats.open_rate ?? 0) || 0;
        const click_rate = Number(stats.click_rate ?? 0) || 0;
        const conv_rate = Number(stats.conversion_rate ?? 0) || 0;
        const value = Number(stats.conversion_value ?? 0) || 0;
        const rpr = Number(stats.revenue_per_recipient ?? 0) || 0;
        if (!flowAgg[gid]) flowAgg[gid] = { recipients: 0, open: 0, click: 0, conv: 0, value: 0, rpr: 0 };
        flowAgg[gid].recipients += recipients;
        flowAgg[gid].open += open_rate * recipients;
        flowAgg[gid].click += click_rate * recipients;
        flowAgg[gid].conv += conv_rate * recipients;
        flowAgg[gid].value += value;
        flowAgg[gid].rpr += rpr * recipients;
      }

      // Replace flow_performance rows for this audit_id
      const flowPerfRows = Object.entries(flowAgg).map(([flowId, a]) => {
        const denom = Math.max(1, a.recipients);
        const actual_open = a.open / denom;
        const actual_click = a.click / denom;
        const actual_conv = a.conv / denom;
        const actual_rpr = a.rpr / denom;
        const flowMeta = flows.ok ? flows.items.find((f: any) => f.id === flowId) : null;
        const flowName = flowMeta?.attributes?.name ?? flowId;
        const flowStatus = (flowMeta?.attributes?.status ?? "live").toLowerCase();
        const mappedStatus =
          flowStatus.includes("draft") ? "draft" : flowStatus.includes("paused") ? "paused" : "live";
        const targetRpr = actual_rpr * 1.15;
        const opportunity = Math.max(0, (targetRpr - actual_rpr) * a.recipients);
        return {
          audit_id: auditId,
          flow_name: flowName,
          flow_status: mappedStatus,
          priority: "medium",
          recipients_per_month: Math.round(a.recipients),
          actual_open_rate: actual_open,
          benchmark_open_rate_low: 0.25,
          benchmark_open_rate_high: 0.45,
          actual_click_rate: actual_click,
          benchmark_click_rate_low: 0.01,
          benchmark_click_rate_high: 0.05,
          actual_conv_rate: actual_conv,
          benchmark_conv_rate_low: 0.001,
          benchmark_conv_rate_high: 0.02,
          monthly_revenue_current: a.value,
          monthly_revenue_opportunity: opportunity,
          notes: "Computed from Klaviyo Reporting API (last_30_days).",
        };
      });
      if (flowPerfRows.length) {
        await mustSucceed("insert flow_performance", sb.from("flow_performance").insert(flowPerfRows));
      } else {
        reportingErrors.push({
          stage: "flow_performance",
          status: 200,
          message: "No flow reporting rows returned for last_30_days; flow_performance was not populated.",
        });
      }
    }

    // Persist rollup record(s) for traceability regardless of report availability
    for (const tf of ["last_30_days", "last_90_days"] as const) {
      const camp = campaignReports.find((r) => r.timeframe === tf)?.results ?? [];
      const flw = flowReports.find((r) => r.timeframe === tf)?.results ?? [];
      await mustSucceed("insert klaviyo_reporting_rollups", sb.from("klaviyo_reporting_rollups").insert({
        audit_id: auditId,
        client_id: clientId,
        timeframe_key: tf,
        conversion_metric_id: conversionMetricId,
        campaigns: camp,
        flows: flw,
        computed: {
          counts: {
            flows: flows.ok ? flows.items.length : null,
            campaigns: campaigns.ok ? campaigns.items.length : null,
            forms: forms.ok ? forms.items.length : null,
            segments: segments.ok ? segments.items.length : null,
            lists: lists.ok ? lists.items.length : null,
          },
          reporting_errors: reportingErrors,
        },
      }));
    }

    // Observability
    const failedEndpoints = Object.entries(scopeDiag).filter(([, v]) => v !== true);
    try {
      await sb.from("klaviyo_runs").insert({
        correlation_id: correlationId,
        audit_id: auditId,
        client_id: clientId,
        status: failedEndpoints.length > 0 ? "partial" : "success",
        revision,
        elapsed_ms: Date.now() - startedAt,
        error_message: failedEndpoints.length > 0 ? JSON.stringify(Object.fromEntries(failedEndpoints)).slice(0, 1000) : null,
      });
    } catch {
      // swallow logging errors
    }

    return json({
      ok: true,
      correlationId,
      revision,
      account: { id: accountId, name: accountName, timezone, preferredCurrency },
      counts: {
        flows: flows.ok ? flows.items.length : null,
        campaigns: campaigns.ok ? campaigns.items.length : null,
        forms: forms.ok ? forms.items.length : null,
        segments: segments.ok ? segments.items.length : null,
        lists: lists.ok ? lists.items.length : null,
      },
      fetch: Object.fromEntries(
        Object.entries(resources).map(([name, res]) => [
          name,
          res.ok
            ? { ok: true, status: res.status ?? 200 }
            : { ok: false, status: res.status ?? null, error: extractKlaviyoError(res) },
        ]),
      ),
      reporting: {
        conversion_metric_id: conversionMetricId,
        conversion_metric_selection: {
          reason: pickedMetric.reason,
          candidates_tested: metricCandidates.slice(0, 10),
        },
        campaign_reports: campaignReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
        flow_reports: flowReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
        errors: reportingErrors,
        reporting_ok: reportingErrors.length === 0,
      },
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : "Unknown error");
    try {
      const sb = assertServiceClient();
      await sb.from("klaviyo_runs").insert({
        correlation_id: correlationId,
        audit_id: auditId,
        client_id: clientId,
        status: "error",
        revision,
        elapsed_ms: Date.now() - startedAt,
        error_code: "fetch_failed",
        error_message: msg.slice(0, 1000),
      });
    } catch {
      // swallow logging errors
    }
    return json({ ok: false, error: { code: "fetch_failed", message: msg }, correlationId }, { status: 500 });
  }
});

