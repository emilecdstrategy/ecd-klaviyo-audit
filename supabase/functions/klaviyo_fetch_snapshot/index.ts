import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type FetchInput = {
  audit_id?: string;
  client_id?: string;
  api_key?: string; // optional if already stored
  revision?: string; // optional override
  mode?: "resume_profile_scan";
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Secret used to encrypt/decrypt Klaviyo keys stored in DB.
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

const KLAVIYO_BASE = "https://a.klaviyo.com";
const DEFAULT_REVISION = "2024-10-15";
const MAX_REPORT_IDS = 50;
const PROFILE_FIRST_PATH =
  "/api/profiles/?page%5Bsize%5D=100&additional-fields%5Bprofile%5D=subscriptions";
/** Space out heavy Reporting API POSTs to reduce 429 bursts (ms). */
const REPORTING_REQUEST_GAP_MS = 1_600;

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

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
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

async function klaviyoCountProfiles(params: {
  apiKey: string;
  revision: string;
  // Optional filter string using Klaviyo filtering syntax
  filter?: string;
  // If provided, count only when predicate returns true
  predicate?: (profile: any) => boolean;
  // Guard rails to avoid blowing the function timeout on huge accounts
  maxPages?: number;
  // Stop early if this time budget is exceeded
  deadlineAtMs?: number;
}) {
  const maxPages = params.maxPages ?? 200; // 200 * 100 = 20k profiles max
  let count = 0;
  let next = `/api/profiles/?page%5Bsize%5D=100&additional-fields%5Bprofile%5D=subscriptions`;
  if (params.filter) next += `&filter=${encodeURIComponent(params.filter)}`;
  let truncated = false;

  for (let i = 0; i < maxPages && next; i++) {
    if (params.deadlineAtMs && Date.now() >= params.deadlineAtMs) {
      truncated = true;
      break;
    }
    const res = await fetchWithRetry(() => klaviyoFetch(params.apiKey, params.revision, next), 3);
    if (!res.ok) return { ok: false as const, status: res.status, body: res.body, count: null, truncated: false };
    const items = res.body?.data ?? [];
    for (const p of items) {
      if (!params.predicate || params.predicate(p)) count += 1;
    }
    const nextUrl: string | null = res.body?.links?.next ?? null;
    if (!nextUrl) {
      next = "";
      break;
    }
    const u = new URL(nextUrl);
    next = `${u.pathname}${u.search}`;
  }

  if (next) truncated = true;
  return { ok: true as const, status: 200, body: null, count, truncated };
}

type ProfileChunkOk = {
  ok: true;
  totalProfiles: number;
  subscribed: number;
  active90d: number;
  suppressed: number;
  truncated: boolean;
  nextPath: string | null;
};

async function computeProfileSnapshotChunk(params: {
  apiKey: string;
  revision: string;
  since90Iso: string;
  startPath: string | null;
  totalProfiles: number;
  subscribed: number;
  active90d: number;
  suppressed: number;
  deadlineAtMs: number;
}): Promise<ProfileChunkOk | { ok: false; status: number; body: any }> {
  const since90Ms = Date.parse(params.since90Iso);
  let totalProfiles = params.totalProfiles;
  let subscribed = params.subscribed;
  let active90d = params.active90d;
  let suppressed = params.suppressed;
  let next = params.startPath ?? PROFILE_FIRST_PATH;

  for (;;) {
    if (Date.now() >= params.deadlineAtMs) {
      return {
        ok: true,
        totalProfiles,
        subscribed,
        active90d,
        suppressed,
        truncated: true,
        nextPath: next,
      };
    }
    const res = await fetchWithRetry(() => klaviyoFetch(params.apiKey, params.revision, next), 3);
    if (!res.ok) {
      return { ok: false, status: res.status, body: res.body };
    }
    const items = res.body?.data ?? [];
    for (const p of items) {
      totalProfiles += 1;

      const consent = String(p?.attributes?.subscriptions?.email?.marketing?.consent ?? "").toUpperCase();
      const isSubscribed = consent === "SUBSCRIBED";
      if (isSubscribed) subscribed += 1;

      const suppressionList = p?.attributes?.subscriptions?.email?.marketing?.suppression;
      if (Array.isArray(suppressionList) ? suppressionList.length > 0 : suppressionList != null) {
        suppressed += 1;
      }

      if (isSubscribed) {
        const updated = p?.attributes?.updated;
        const updatedMs = typeof updated === "string" ? Date.parse(updated) : NaN;
        if (Number.isFinite(updatedMs) && Number.isFinite(since90Ms) && updatedMs >= since90Ms) {
          active90d += 1;
        }
      }
    }
    const nextUrl: string | null = res.body?.links?.next ?? null;
    if (!nextUrl) {
      return {
        ok: true,
        totalProfiles,
        subscribed,
        active90d,
        suppressed,
        truncated: false,
        nextPath: null,
      };
    }
    const u = new URL(nextUrl);
    next = `${u.pathname}${u.search}`;
  }
}

async function chainProfileResume(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const url = `${SUPABASE_URL}/functions/v1/klaviyo_fetch_snapshot`;
  // Await the fetch so the HTTP request is guaranteed to leave before the
  // edge function isolate shuts down.  We race with a 4s timeout so we never
  // block the response for long — we only need the request to be *sent*, not
  // for the downstream invocation to finish.
  try {
    await Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ mode: "resume_profile_scan", audit_id: auditId }),
      }),
      sleep(4_000),
    ]);
  } catch { /* swallow – best effort */ }
}

async function finalizeProfileScan(
  sb: ReturnType<typeof assertServiceClient>,
  auditId: string,
  totalProfiles: number,
  subscribed: number,
  active90d: number,
  suppressed: number,
  stagedRpr: number | null,
) {
  const { data: rollups } = await sb.from("klaviyo_reporting_rollups").select("id, computed").eq("audit_id", auditId);
  if (!rollups?.length) return;

  const accountSnapshotPatch = {
    total_profiles_count: totalProfiles,
    email_subscribed_profiles_count: subscribed,
    active_profiles_90d_count: active90d,
    suppressed_profiles_count: suppressed,
    email_subscribed_profiles_truncated: false,
    active_profiles_90d_truncated: false,
    suppressed_profiles_truncated: false,
    profile_scan_status: "complete",
    computed_at: new Date().toISOString(),
  };

  let finalRprForAudit: number | null = stagedRpr;
  for (const row of rollups) {
    const c = (row.computed ?? {}) as Record<string, unknown>;
    const existing = (c.account_snapshot ?? {}) as Record<string, unknown>;
    const prevDm = (c.derived_metrics ?? {}) as Record<string, unknown>;
    const prevRpr = prevDm.revenue_per_recipient;
    const rprMerged =
      stagedRpr ??
      (typeof prevRpr === "number" && Number.isFinite(prevRpr) ? prevRpr : null);
    if (finalRprForAudit == null && rprMerged != null) finalRprForAudit = rprMerged;
    const derived_metrics = {
      ...prevDm,
      list_size: totalProfiles,
      monthly_engagement: subscribed,
      revenue_per_recipient: rprMerged,
    };
    const account_snapshot = { ...existing, ...accountSnapshotPatch };
    const computed = { ...c, account_snapshot, derived_metrics };
    await mustSucceed("update klaviyo_reporting_rollups profile merge", sb.from("klaviyo_reporting_rollups").update({ computed }).eq("id", row.id));
  }

  await mustSucceed("update audits profile metrics", sb.from("audits").update({
    list_size: totalProfiles,
    monthly_traffic: subscribed,
    aov: finalRprForAudit ?? 0,
  }).eq("id", auditId));

  await mustSucceed("complete profile scan job", sb.from("klaviyo_profile_scan_jobs").update({
    status: "complete",
    next_path: null,
    total_profiles: totalProfiles,
    subscribed,
    active90d,
    suppressed,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("audit_id", auditId));
}

async function handleResumeProfileScan(auditId: string, correlationId: string): Promise<Response> {
  const sb = assertServiceClient();
  const { data: claimRows, error: claimErr } = await sb.rpc("claim_profile_scan_job", { p_audit_id: auditId });
  if (claimErr) {
    return json({ ok: false, error: { code: "claim_failed", message: claimErr.message }, correlationId }, { status: 500 });
  }
  const claimed = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as Record<string, unknown> | null | undefined;
  if (!claimed) {
    const { data: job } = await sb.from("klaviyo_profile_scan_jobs").select("status").eq("audit_id", auditId).maybeSingle();
    if (!job) return json({ ok: false, error: { code: "not_found", message: "No profile scan job" }, correlationId }, { status: 404 });
    if (job.status === "complete") return json({ ok: true, correlationId, profile_metrics_status: "complete" });
    if (job.status === "failed") return json({ ok: false, correlationId, profile_metrics_status: "failed" });
    return json({ ok: true, correlationId, profile_metrics_status: "skipped", reason: "already_running" });
  }

  const startedAt = Date.now();
  const deadlineAtMs = startedAt + 145_000;
  let apiKey: string;
  try {
    const { data: sec, error } = await sb.from("client_secrets").select("*").eq("client_id", claimed.client_id as string).maybeSingle();
    if (error) throw error;
    if (!sec?.klaviyo_private_key_ciphertext || !sec?.klaviyo_private_key_iv) throw new Error("No Klaviyo key for client");
    apiKey = await decryptString(sec.klaviyo_private_key_ciphertext, sec.klaviyo_private_key_iv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Key error";
    await sb.from("klaviyo_profile_scan_jobs").update({
      status: "failed",
      error_message: msg.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({ ok: false, error: { code: "key_error", message: msg }, correlationId }, { status: 200 });
  }

  const startPath = (claimed.next_path as string | null) ?? null;
  const chunk = await computeProfileSnapshotChunk({
    apiKey,
    revision: String(claimed.revision),
    since90Iso: String(claimed.since90_iso),
    startPath,
    totalProfiles: Number(claimed.total_profiles ?? 0),
    subscribed: Number(claimed.subscribed ?? 0),
    active90d: Number(claimed.active90d ?? 0),
    suppressed: Number(claimed.suppressed ?? 0),
    deadlineAtMs,
  });

  if (!chunk.ok) {
    await sb.from("klaviyo_profile_scan_jobs").update({
      status: "failed",
      error_message: trimBody(chunk.body) ?? "Klaviyo profile fetch failed",
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId);
    return json({ ok: false, correlationId, profile_metrics_status: "failed", error: "profile_fetch_failed" }, { status: 200 });
  }

  if (chunk.truncated && chunk.nextPath) {
    await mustSucceed("profile job progress", sb.from("klaviyo_profile_scan_jobs").update({
      status: "pending",
      next_path: chunk.nextPath,
      total_profiles: chunk.totalProfiles,
      subscribed: chunk.subscribed,
      active90d: chunk.active90d,
      suppressed: chunk.suppressed,
      updated_at: new Date().toISOString(),
    }).eq("audit_id", auditId));
    await chainProfileResume(auditId);
    return json({ ok: true, correlationId, profile_metrics_status: "in_progress" });
  }

  const staged = claimed.staged_revenue_per_recipient;
  const stagedRpr = staged != null && Number.isFinite(Number(staged)) ? Number(staged) : null;
  await finalizeProfileScan(sb, auditId, chunk.totalProfiles, chunk.subscribed, chunk.active90d, chunk.suppressed, stagedRpr);
  return json({ ok: true, correlationId, profile_metrics_status: "complete" });
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
  const retryAfterMs = retryAfterMsFromHttpHeaders(res.headers);
  return { ok: res.ok, status: res.status, body, retryAfterMs };
}

/** Standard Retry-After header (seconds). */
function retryAfterMsFromHttpHeaders(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const sec = Number(raw.trim());
  if (!Number.isFinite(sec) || sec < 0) return null;
  return Math.min(120_000, Math.max(1_000, sec * 1000));
}

function retryAfterMsFromKlaviyo429(body: any): number | null {
  try {
    const detail = body?.errors?.[0]?.detail;
    if (typeof detail !== "string") return null;
    const m = detail.match(/expected available in\s+(\d+)\s+seconds/i);
    if (!m?.[1]) return null;
    const seconds = Number(m[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(90_000, Math.max(1_000, seconds * 1000));
  } catch {
    return null;
  }
}

type ValuesReportResult = Awaited<ReturnType<typeof queryValuesReport>>;

async function queryValuesReportWithBackoff(
  params: Parameters<typeof queryValuesReport>[0] & { deadlineAtMs?: number },
) {
  // Values reports throttle often; retry 429s with server-suggested or exponential waits (never cap at 4s).
  const maxAttempts = 8;
  let last: ValuesReportResult = {
    ok: false,
    status: 0,
    body: null,
    retryAfterMs: null,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await queryValuesReport(params);
    if (last.ok) return last;
    if (last.status !== 429) return last;
    if (attempt === maxAttempts) return last;

    const fromBody = retryAfterMsFromKlaviyo429(last.body);
    const fromHeader = last.retryAfterMs;
    const exponential = Math.min(90_000, 1_200 * Math.pow(2, attempt - 1));
    const retryMs = Math.min(90_000, Math.max(1_200, fromBody ?? fromHeader ?? exponential));

    if (params.deadlineAtMs) {
      const slack = params.deadlineAtMs - Date.now() - 2_000;
      if (slack < 800) return last;
      await sleep(Math.min(retryMs, slack));
    } else {
      await sleep(retryMs);
    }
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
  for (let i = 0; i < candidates.length; i++) {
    const metricId = candidates[i];
    if (i > 0) await sleep(900);
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

  let bodyJson: FetchInput;
  try {
    bodyJson = (await req.json()) as FetchInput;
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Invalid JSON body" }, correlationId }, { status: 400 });
  }

  if (bodyJson.mode === "resume_profile_scan") {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: { code: "config_missing", message: "Supabase env missing" }, correlationId }, { status: 500 });
    }
    // Accept service role key (server-to-server chain) OR authenticated user (frontend retry)
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
    if (!isServiceRole) {
      try {
        await requireAuthenticatedUser(req);
      } catch {
        return json({ ok: false, error: { code: "unauthorized", message: "Invalid authorization" }, correlationId }, { status: 401 });
      }
    }
    const resumeAuditId = (bodyJson.audit_id ?? "").trim();
    if (!resumeAuditId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });
    }
    try {
      return await handleResumeProfileScan(resumeAuditId, correlationId);
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : "Unknown error");
      return json({ ok: false, error: { code: "resume_failed", message: msg }, correlationId }, { status: 500 });
    }
  }

  const startedAt = Date.now();
  // Leave ~2s headroom under typical 150s edge limits so retries can finish.
  const deadlineAtMs = startedAt + 148_000;
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

    const input = bodyJson;
    auditId = input.audit_id ?? null;
    clientId = input.client_id ?? null;
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

      // Best-effort: fetch HTML of the most recent sent campaign for email design comparison
      try {
        const sentCampaigns = campaigns.items
          .filter((c: any) => (c.attributes?.status ?? "").toLowerCase() === "sent")
          .sort((a: any, b: any) => {
            const da = a.attributes?.updated_at || a.attributes?.created_at || "";
            const db = b.attributes?.updated_at || b.attributes?.created_at || "";
            return db.localeCompare(da);
          });
        const recentCampaign = sentCampaigns[0];
        if (recentCampaign) {
          const msgRes = await klaviyoFetch(apiKey, revision, `/api/campaigns/${recentCampaign.id}/campaign-messages/`);
          const messages = msgRes.ok ? (msgRes.body?.data ?? []) : [];
          let emailHtml: string | null = null;
          for (const msg of messages) {
            const htmlBody = msg?.attributes?.content?.html;
            if (htmlBody) { emailHtml = htmlBody; break; }
            const templateId = msg?.relationships?.template?.data?.id;
            if (templateId) {
              const tplRes = await klaviyoFetch(apiKey, revision, `/api/templates/${templateId}/`);
              if (tplRes.ok && tplRes.body?.data?.attributes?.html) {
                emailHtml = tplRes.body.data.attributes.html;
                break;
              }
            }
          }
          if (emailHtml) {
            await sb.from("audit_email_design").upsert({
              audit_id: auditId,
              client_email_html: emailHtml,
              client_campaign_name: recentCampaign.attributes?.name ?? null,
              client_campaign_id: recentCampaign.id,
            }, { onConflict: "audit_id" }).select();
          }
        }
      } catch { /* non-critical */ }
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

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // 5) Reporting rollups (values reports). Profile KPIs are filled by chained resume invocations.
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

    // Keep reporting lightweight to avoid edge runtime timeout on large accounts.
    const timeframeKeys: Array<"last_30_days" | "last_90_days"> = ["last_30_days"];
    const flowReportStats = ["recipients", "open_rate", "click_rate", "conversion_rate", "conversion_value", "revenue_per_recipient"];
    const campaignReportStats = [
      "recipients",
      "open_rate",
      "click_rate",
      "conversion_rate",
      "conversion_value",
      "revenue_per_recipient",
      "bounce_rate",
      "spam_complaint_rate",
    ];
    const reportingErrors: Array<{ stage: string; status?: number | null; message: string }> = [];
    /** Weighted flow revenue / recipients (last_30_days reporting); mirrors public report "Revenue / Recipient". */
    let revenuePerRecipient: number | null = null;

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
      await sleep(REPORTING_REQUEST_GAP_MS);

      // Campaign values: email only
      for (const tf of timeframeKeys) {
        const rep = await queryValuesReportWithBackoff({
          apiKey,
          revision,
          endpointPath: "/api/campaign-values-reports/",
          timeframeKey: tf,
          conversionMetricId,
          filter: "contains-any(send_channel,[\"email\"])",
          statistics: campaignReportStats,
          groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
          deadlineAtMs,
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
        await sleep(REPORTING_REQUEST_GAP_MS);
      }

      // Separate 90-day campaign report for bounce/spam (UI promises "last 90 days"; timeframeKeys stays last_30 only for flows).
      if (!timeframeKeys.includes("last_90_days")) {
        const repCamp90 = await queryValuesReportWithBackoff({
          apiKey,
          revision,
          endpointPath: "/api/campaign-values-reports/",
          timeframeKey: "last_90_days",
          conversionMetricId,
          filter: "contains-any(send_channel,[\"email\"])",
          statistics: campaignReportStats,
          groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
          deadlineAtMs,
        });
        if (repCamp90.ok) {
          campaignReports.push({ timeframe: "last_90_days", results: repCamp90.body?.data?.attributes?.results ?? [] });
        } else {
          reportingErrors.push({
            stage: "campaign_values_last_90_days",
            status: repCamp90.status ?? null,
            message: trimBody(repCamp90.body) ?? "Campaign values report failed (last_90_days)",
          });
        }
        await sleep(REPORTING_REQUEST_GAP_MS);
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
          statistics: flowReportStats,
          groupBy: ["flow_id", "flow_message_id", "send_channel"],
          deadlineAtMs,
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

      // Compute flow_performance rows (aggregate by flow_id) + count distinct email messages per flow
      const flowAgg: Record<string, { recipients: number; open: number; click: number; conv: number; value: number; rpr: number; messageIds: Set<string> }> = {};
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
        if (!flowAgg[gid]) flowAgg[gid] = { recipients: 0, open: 0, click: 0, conv: 0, value: 0, rpr: 0, messageIds: new Set() };
        flowAgg[gid].recipients += recipients;
        flowAgg[gid].open += open_rate * recipients;
        flowAgg[gid].click += click_rate * recipients;
        flowAgg[gid].conv += conv_rate * recipients;
        flowAgg[gid].value += value;
        flowAgg[gid].rpr += rpr * recipients;
        const mid = row?.groupings?.flow_message_id;
        if (mid) flowAgg[gid].messageIds.add(mid);
      }

      // Replace flow_performance rows for this audit_id
      const NON_REVENUE_PATTERNS = [
        /review\s*request/i, /review\s*follow/i, /feedback/i, /survey/i, /nps/i,
        /sunset/i, /list\s*clean/i, /unengaged/i, /re-?engage/i, /winback/i, /win-?back/i,
        /birthday/i, /anniversary/i, /thank\s*you/i, /order\s*confirm/i,
        /shipping/i, /delivery/i, /fulfillment/i, /transactional/i,
        /password\s*reset/i, /account\s*confirm/i, /double\s*opt/i,
        /referral/i, /loyalty/i, /reward/i, /points/i,
      ];
      const isNonRevenueFlow = (name: string) => NON_REVENUE_PATTERNS.some(p => p.test(name));

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
        const nonRevenue = isNonRevenueFlow(flowName);
        const targetRpr = actual_rpr * 1.15;
        const opportunity = nonRevenue ? 0 : Math.max(0, (targetRpr - actual_rpr) * a.recipients);
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
          benchmark_conv_rate_low: nonRevenue ? 0 : 0.001,
          benchmark_conv_rate_high: nonRevenue ? 0 : 0.02,
          monthly_revenue_current: a.value,
          monthly_revenue_opportunity: opportunity,
          email_message_count: a.messageIds.size || null,
          notes: nonRevenue
            ? "Non-revenue flow (engagement-only). Conv/revenue benchmarks not applicable."
            : "Computed from Klaviyo Reporting API (last_30_days).",
        };
      });
      if (flowPerfRows.length) {
        await mustSucceed("insert flow_performance", sb.from("flow_performance").insert(flowPerfRows));
        const totalRev = flowPerfRows.reduce((s, r) => s + (Number(r.monthly_revenue_current) || 0), 0);
        const totalRecip = flowPerfRows.reduce((s, r) => s + (Number(r.recipients_per_month) || 0), 0);
        if (totalRecip > 0) revenuePerRecipient = totalRev / totalRecip;
      } else {
        reportingErrors.push({
          stage: "flow_performance",
          status: 200,
          message: "No flow reporting rows returned for last_30_days; flow_performance was not populated.",
        });
      }
    }

    // Deliverability indicators (last 90 days, email campaigns only) computed from campaign values report
    let bounceRate90d: number | null = null;
    let spamRate90d: number | null = null;
    const camp90 =
      campaignReports.find((r) => r.timeframe === "last_90_days")?.results
      ?? campaignReports.find((r) => r.timeframe === "last_30_days")?.results
      ?? [];
    if (Array.isArray(camp90) && camp90.length > 0) {
      let denom = 0;
      let bounceNum = 0;
      let spamNum = 0;
      for (const row of camp90) {
        const stats = row?.statistics ?? {};
        const recipients = Number(stats.recipients ?? 0) || 0;
        const b = Number(stats.bounce_rate ?? NaN);
        const s = Number(stats.spam_complaint_rate ?? NaN);
        if (recipients <= 0) continue;
        denom += recipients;
        if (Number.isFinite(b)) bounceNum += b * recipients;
        if (Number.isFinite(s)) spamNum += s * recipients;
      }
      if (denom > 0) {
        bounceRate90d = bounceNum / denom;
        spamRate90d = spamNum / denom;
      }
    }

    const accountSnapshot = {
      email_subscribed_profiles_count: null as number | null,
      active_profiles_90d_count: null as number | null,
      suppressed_profiles_count: null as number | null,
      bounce_rate_90d: bounceRate90d,
      spam_rate_90d: spamRate90d,
      deliverability_campaign_timeframe: campaignReports.some((r) => r.timeframe === "last_90_days") ? "last_90_days" : "last_30_days",
      active_profiles_definition: "Proxy: email-subscribed profiles updated in last 90 days",
      email_subscribed_profiles_truncated: null as boolean | null,
      active_profiles_90d_truncated: null as boolean | null,
      suppressed_profiles_truncated: null as boolean | null,
      profile_scan_status: "pending" as const,
      computed_at: new Date().toISOString(),
    };

    const derivedMetricsPartial = {
      list_size: 0,
      monthly_engagement: 0,
      revenue_per_recipient: revenuePerRecipient,
    };

    for (const tf of timeframeKeys) {
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
          account_snapshot: accountSnapshot,
          derived_metrics: derivedMetricsPartial,
        },
      }));
    }

    await mustSucceed("upsert klaviyo_profile_scan_jobs", sb.from("klaviyo_profile_scan_jobs").upsert({
      audit_id: auditId,
      client_id: clientId,
      revision,
      since90_iso: since90,
      next_path: null,
      subscribed: 0,
      active90d: 0,
      suppressed: 0,
      status: "pending",
      staged_revenue_per_recipient: revenuePerRecipient,
      error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "audit_id" }));

    await chainProfileResume(auditId);

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
      account_snapshot: accountSnapshot,
      profile_metrics_status: "pending" as const,
      derived_metrics: {
        /** Filled to 0 until profile job completes; then finalized in DB and on poll. */
        list_size: 0,
        monthly_engagement: 0,
        /** Flow email revenue per recipient (last 30d); available immediately from reporting. */
        revenue_per_recipient: revenuePerRecipient,
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

