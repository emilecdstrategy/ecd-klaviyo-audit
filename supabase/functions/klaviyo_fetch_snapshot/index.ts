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
      await sb.from("client_secrets").upsert({
        client_id: clientId,
        klaviyo_private_key_ciphertext: enc.ciphertext,
        klaviyo_private_key_iv: enc.iv,
        klaviyo_private_key_alg: enc.alg,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id" });
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
    const [flows, lists, segments, forms, campaigns] = await Promise.all([
      klaviyoPaged(apiKey, revision, "/api/flows/?page%5Bsize%5D=50"),
      klaviyoPaged(apiKey, revision, "/api/lists/?page%5Bsize%5D=10"),
      klaviyoPaged(apiKey, revision, "/api/segments/?page%5Bsize%5D=10"),
      klaviyoPaged(apiKey, revision, "/api/forms/?page%5Bsize%5D=100"),
      // Campaign listing requires channel filter per docs (use email).
      klaviyoPaged(apiKey, revision, "/api/campaigns/?page%5Bsize%5D=10&filter=equals(messages.channel,'email')"),
    ]);

    // 3) Persist snapshots (clear prior snapshots for this audit_id to keep latest)
    await Promise.all([
      sb.from("klaviyo_flow_snapshots").delete().eq("audit_id", auditId),
      sb.from("klaviyo_campaign_snapshots").delete().eq("audit_id", auditId),
      sb.from("klaviyo_form_snapshots").delete().eq("audit_id", auditId),
      sb.from("klaviyo_segment_snapshots").delete().eq("audit_id", auditId),
      sb.from("klaviyo_reporting_rollups").delete().eq("audit_id", auditId),
    ]);

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
      if (rows.length) await sb.from("klaviyo_flow_snapshots").insert(rows);
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
      if (rows.length) await sb.from("klaviyo_campaign_snapshots").insert(rows);
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
      if (rows.length) await sb.from("klaviyo_form_snapshots").insert(rows);
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
      if (rows.length) await sb.from("klaviyo_segment_snapshots").insert(rows);
    }

    // 4) Store connection metadata
    const scopes = {
      accounts: accountRes.ok,
      flows: flows.ok,
      lists: lists.ok,
      segments: segments.ok,
      forms: forms.ok,
      campaigns: campaigns.ok,
    };
    await sb.from("klaviyo_connections").upsert({
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
    }, { onConflict: "client_id" });

    // Backfill client website if missing.
    if (websiteUrl) {
      const { data: existingClient } = await sb.from("clients").select("website_url").eq("id", clientId).maybeSingle();
      if (!existingClient?.website_url) {
        await sb.from("clients").update({ website_url: websiteUrl }).eq("id", clientId);
      }
    }

    await sb.from("clients").update({ klaviyo_connected: true }).eq("id", clientId);

    // 5) Reporting rollups (values reports)
    // Reporting endpoints require conversion_metric_id. We'll attempt to resolve "Placed Order" metric id.
    const metricsRes = await klaviyoPaged(apiKey, revision, "/api/metrics/?page%5Bsize%5D=50", 5);
    const placedOrderMetric = metricsRes.ok
      ? metricsRes.items.find((m: any) => (m?.attributes?.name ?? "").toLowerCase() === "placed order")
      : null;
    const conversionMetricId = placedOrderMetric?.id ?? (metricsRes.ok ? metricsRes.items?.[0]?.id : null);

    const timeframeKeys: Array<"last_30_days" | "last_90_days"> = ["last_30_days", "last_90_days"];
    const reportStats = ["recipients", "open_rate", "click_rate", "conversion_rate", "conversion_value", "revenue_per_recipient"];

    let campaignReports: any[] = [];
    let flowReports: any[] = [];

    if (conversionMetricId) {
      // Campaign values: email only
      for (const tf of timeframeKeys) {
        const rep = await fetchWithRetry(
          () =>
            queryValuesReport({
              apiKey,
              revision,
              endpointPath: "/api/campaign-values-reports/",
              timeframeKey: tf,
              conversionMetricId,
              filter: "contains-any(send_channel,[\"email\"])",
              statistics: reportStats,
              groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
            }),
          3,
        );
        if (rep.ok) campaignReports.push({ timeframe: tf, results: rep.body?.data?.attributes?.results ?? [] });
      }

      // Flow values: limit to first N flows to stay within rate limits and filter limits.
      const flowIds = flows.ok ? flows.items.map((f: any) => f.id).slice(0, MAX_REPORT_IDS) : [];
      const flowFilter = flowIds.length
        ? `contains-any(flow_id,[${flowIds.map((id) => JSON.stringify(id)).join(",")}])`
        : undefined;

      for (const tf of timeframeKeys) {
        const rep = await fetchWithRetry(
          () =>
            queryValuesReport({
              apiKey,
              revision,
              endpointPath: "/api/flow-values-reports/",
              timeframeKey: tf,
              conversionMetricId,
              filter: flowFilter,
              statistics: reportStats,
              groupBy: ["flow_id", "flow_message_id", "send_channel"],
            }),
          3,
        );
        if (rep.ok) flowReports.push({ timeframe: tf, results: rep.body?.data?.attributes?.results ?? [] });
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
      await sb.from("flow_performance").delete().eq("audit_id", auditId);
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
      if (flowPerfRows.length) await sb.from("flow_performance").insert(flowPerfRows);
    }

    // Persist rollup record(s) for traceability regardless of report availability
    for (const tf of ["last_30_days", "last_90_days"] as const) {
      const camp = campaignReports.find((r) => r.timeframe === tf)?.results ?? [];
      const flw = flowReports.find((r) => r.timeframe === tf)?.results ?? [];
      await sb.from("klaviyo_reporting_rollups").insert({
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
        },
      });
    }

    // Observability
    try {
      await sb.from("klaviyo_runs").insert({
        correlation_id: correlationId,
        audit_id: auditId,
        client_id: clientId,
        status: "success",
        revision,
        elapsed_ms: Date.now() - startedAt,
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
      reporting: {
        conversion_metric_id: conversionMetricId,
        campaign_reports: campaignReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
        flow_reports: flowReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
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

