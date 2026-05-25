import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization } from "../_shared/auth.ts";

// Stage machine: each stage runs in its own edge invocation with a fresh ~150s
// budget. `config` is the entry point the frontend calls; subsequent stages
// chain via self-POST so long accounts can't exceed one invocation's budget.
//
//   stage=config            -> fetch account + snapshots + resolve/cache conversion metric, chain reporting
//   stage=reporting         -> run 30d/90d values reports + flow_performance + rollups, chain profile if full
//   stage=profile           -> seed profile scan job + chain resume_profile_scan
//   stage=resume_profile_scan -> process one chunk of /api/profiles/ and self-chain if truncated
//
// Back-compat: if neither `stage` nor `mode` is provided, behave like `config`
// (so older clients keep working through the same entry point).
type Stage =
  | "config"
  | "reporting"
  | "profile"
  | "resume_profile_scan";

type FetchInput = {
  audit_id?: string;
  client_id?: string;
  api_key?: string;
  revision?: string;
  stage?: Stage;
  // Legacy alias kept for old clients that only know `mode: "resume_profile_scan"`.
  mode?: "resume_profile_scan";
  profile_scan?: "full" | "fast";
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

const KLAVIYO_BASE = "https://a.klaviyo.com";
const DEFAULT_REVISION = "2024-10-15";
/** Flow-id cap for values-reports filter. Flamingo Estate has >50 flows. */
const MAX_REPORT_IDS = 100;
/** 5 pages × 100 = 500 email campaigns max per snapshot. */
const MAX_CAMPAIGN_PAGES = 5;
const CAMPAIGN_SNAPSHOT_CAP = 500;
const MAX_LIST_SEGMENT_PAGES = 5;
const METRICS_MAX_PAGES = 5;
/** Skip optional email HTML fetch if less than this many ms remain before deadline. */
const MIN_SLACK_MS_EMAIL_HTML = 15_000;
/** Full enumeration is required for exact consent/suppression counts; Klaviyo has no aggregate-only endpoint for those metrics. */
const PROFILE_FIRST_PATH =
  "/api/profiles/?page%5Bsize%5D=100&additional-fields%5Bprofile%5D=subscriptions";
/** Per-client cached metric is honored for this long before we re-probe. */
const METRIC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Klaviyo values-reports are documented at 1/s burst + 2/min steady. */
const REPORTING_TOKENS_PER_MIN = 2;
const REPORTING_BURST = 1;
/** Hard timeout on any single Klaviyo HTTP call so a hung socket can't burn our whole stage budget. */
const KLAVIYO_HTTP_TIMEOUT_MS = 30_000;

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
  await getUserIdFromAuthorization(req);
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

// ---------------------------------------------------------------------------
// Klaviyo HTTP helpers
// ---------------------------------------------------------------------------

async function klaviyoFetch(apiKey: string, revision: string, path: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), KLAVIYO_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${KLAVIYO_BASE}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Klaviyo-API-Key ${apiKey}`,
        revision,
      },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    const aborted = (e as any)?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 0,
      body: aborted ? `Klaviyo request timed out after ${KLAVIYO_HTTP_TIMEOUT_MS}ms` : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithRetry(fn: () => Promise<{ ok: boolean; status: number; body: any }>, attempts = 3) {
  let last: any = null;
  for (let i = 1; i <= attempts; i++) {
    const res = await fn();
    last = res;
    if (res.ok) return res;
    if (![429, 500, 502, 503, 504].includes(res.status)) return res;
    const delay = 400 * Math.pow(2, i - 1);
    await sleep(delay);
  }
  return last;
}

async function klaviyoPaged(apiKey: string, revision: string, path: string, maxPages = 10) {
  const out: any[] = [];
  let next = path;
  let truncated = false;
  for (let i = 0; i < maxPages && next; i++) {
    const res = await fetchWithRetry(() => klaviyoFetch(apiKey, revision, next), 3);
    if (!res.ok) return { ok: false as const, status: res.status, body: res.body, items: out, truncated: false };
    const items = res.body?.data ?? [];
    out.push(...items);
    const nextUrl: string | null = res.body?.links?.next ?? null;
    if (!nextUrl) break;
    if (i === maxPages - 1) {
      truncated = true;
      break;
    }
    const u = new URL(nextUrl);
    next = `${u.pathname}${u.search}`;
  }
  return { ok: true as const, status: 200, items: out, truncated };
}

// ---------------------------------------------------------------------------
// Profile scan helpers
// ---------------------------------------------------------------------------

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

/**
 * Fire-and-forget POST to this same edge function with the given stage payload.
 * We await only long enough to confirm the request left the isolate; the
 * downstream invocation continues on its own fresh budget.
 */
async function chainStage(stage: Stage, auditId: string, extra: Record<string, unknown> = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const url = `${SUPABASE_URL}/functions/v1/klaviyo_fetch_snapshot`;
  const body: Record<string, unknown> = { stage, audit_id: auditId, ...extra };
  try {
    await Promise.race([
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify(body),
      }),
      sleep(4_000),
    ]);
  } catch { /* best effort */ }
}

async function chainAuditAnalysis(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/audit_finalize_analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId }),
      }),
      sleep(4_000),
    ]);
  } catch { /* best effort */ }
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

  await chainAuditAnalysis(auditId);
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
    if (job.status === "skipped") return json({ ok: true, correlationId, profile_metrics_status: "complete" });
    if (job.status === "failed") return json({ ok: false, correlationId, profile_metrics_status: "failed" });
    return json({ ok: true, correlationId, profile_metrics_status: "skipped", reason: "already_running" });
  }

  const startedAt = Date.now();
  // Full 148s headroom (was 145s). We don't chain until after this returns so
  // we can use the full edge budget.
  const deadlineAtMs = startedAt + 148_000;
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
    await logStageRun(sb, {
      correlationId,
      auditId,
      clientId: (claimed.client_id as string) ?? null,
      stage: "resume_profile_scan",
      status: "error",
      revision: String(claimed.revision ?? DEFAULT_REVISION),
      elapsedMs: Date.now() - startedAt,
      errorCode: "key_error",
      errorMessage: msg,
    });
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
    await logStageRun(sb, {
      correlationId,
      auditId,
      clientId: (claimed.client_id as string) ?? null,
      stage: "resume_profile_scan",
      status: "error",
      revision: String(claimed.revision ?? DEFAULT_REVISION),
      elapsedMs: Date.now() - startedAt,
      errorCode: `profile_${chunk.status}`,
      errorMessage: trimBody(chunk.body) ?? "profile fetch failed",
    });
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
    await chainStage("resume_profile_scan", auditId);
    await logStageRun(sb, {
      correlationId,
      auditId,
      clientId: (claimed.client_id as string) ?? null,
      stage: "resume_profile_scan",
      status: "partial",
      revision: String(claimed.revision ?? DEFAULT_REVISION),
      elapsedMs: Date.now() - startedAt,
      errorMessage: `chunk_ok total=${chunk.totalProfiles} subscribed=${chunk.subscribed}`,
    });
    return json({ ok: true, correlationId, profile_metrics_status: "in_progress" });
  }

  const staged = claimed.staged_revenue_per_recipient;
  const stagedRpr = staged != null && Number.isFinite(Number(staged)) ? Number(staged) : null;
  await finalizeProfileScan(sb, auditId, chunk.totalProfiles, chunk.subscribed, chunk.active90d, chunk.suppressed, stagedRpr);
  await logStageRun(sb, {
    correlationId,
    auditId,
    clientId: (claimed.client_id as string) ?? null,
    stage: "resume_profile_scan",
    status: "success",
    revision: String(claimed.revision ?? DEFAULT_REVISION),
    elapsedMs: Date.now() - startedAt,
    errorMessage: `final total=${chunk.totalProfiles} subscribed=${chunk.subscribed}`,
  });
  return json({ ok: true, correlationId, profile_metrics_status: "complete" });
}

// ---------------------------------------------------------------------------
// Reporting (values reports) + rate limiting
// ---------------------------------------------------------------------------

/**
 * Simple token bucket with both burst and per-minute steady caps. Klaviyo's
 * Query Campaign/Flow Values are documented at 1/s burst + 2/min steady, so
 * running these POSTs through a shared bucket avoids bursts of 429s that each
 * carry 30-60s Retry-After waits.
 */
function createReportingBucket(opts: { tokensPerMin: number; burst: number }) {
  let tokens = opts.burst;
  let lastRefill = Date.now();
  const refillIntervalMs = 60_000 / opts.tokensPerMin;
  async function take() {
    for (;;) {
      const now = Date.now();
      const elapsed = now - lastRefill;
      const refill = Math.floor(elapsed / refillIntervalMs);
      if (refill > 0) {
        tokens = Math.min(opts.burst + opts.tokensPerMin - 1, tokens + refill);
        lastRefill += refill * refillIntervalMs;
      }
      if (tokens > 0) {
        tokens -= 1;
        return;
      }
      const waitMs = refillIntervalMs - (now - lastRefill);
      await sleep(Math.max(50, Math.min(refillIntervalMs, waitMs)));
    }
  }
  return { take };
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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), KLAVIYO_HTTP_TIMEOUT_MS);
  try {
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
      signal: ctrl.signal,
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
  } catch (e) {
    const aborted = (e as any)?.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 0,
      body: aborted ? `Reporting request timed out after ${KLAVIYO_HTTP_TIMEOUT_MS}ms` : String(e),
      retryAfterMs: null as number | null,
    };
  } finally {
    clearTimeout(t);
  }
}

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
  params: Parameters<typeof queryValuesReport>[0] & {
    deadlineAtMs?: number;
    bucket?: { take: () => Promise<void> };
  },
) {
  // Values reports throttle often; retry 429s with server-suggested or exponential waits (never cap at 4s).
  const maxAttempts = 5;
  let last: ValuesReportResult = {
    ok: false,
    status: 0,
    body: null,
    retryAfterMs: null,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (params.bucket) await params.bucket.take();
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
  deadlineAtMs?: number;
  bucket?: { take: () => Promise<void> };
}) {
  const candidates = Array.from(new Set(params.candidateMetricIds.filter(Boolean)));
  const timeBudgetMs = params.deadlineAtMs ? params.deadlineAtMs - Date.now() : 30_000;
  // Hard cap: 15s max for probing to leave room for actual reporting queries.
  const probeDeadline = Date.now() + Math.min(timeBudgetMs * 0.15, 15_000);
  let probesRun = 0;

  const sampleFlowIds = params.flowIds.slice(0, 10);
  const flowFilter = sampleFlowIds.length
    ? `contains-any(flow_id,[${sampleFlowIds.map((id) => JSON.stringify(id)).join(",")}])`
    : undefined;

  function hasNonZeroConversion(rows: any[]): boolean {
    return rows.some((r: any) => {
      const stats = r?.statistics ?? {};
      return Number(stats.conversion_value ?? 0) > 0 || Number(stats.conversion_uniques ?? 0) > 0;
    });
  }

  const pass1Count = Math.min(candidates.length, 4);
  for (let i = 0; i < pass1Count; i++) {
    if (Date.now() >= probeDeadline) break;
    const metricId = candidates[i];
    probesRun++;
    const probe = await fetchWithRetry(
      () =>
        queryValuesReportWithBackoff({
          apiKey: params.apiKey,
          revision: params.revision,
          endpointPath: "/api/flow-values-reports/",
          timeframeKey: "last_30_days",
          conversionMetricId: metricId,
          filter: flowFilter,
          statistics: ["recipients", "conversion_value"],
          groupBy: ["flow_id"],
          deadlineAtMs: probeDeadline,
          bucket: params.bucket,
        }),
      1,
    );
    if (!probe.ok) continue;
    if (hasNonZeroConversion(probe.body?.data?.attributes?.results ?? [])) {
      return { metricId, reason: "probe_flow_filtered" as const, probesRun };
    }
  }

  for (let i = 0; i < Math.min(candidates.length, 2); i++) {
    if (Date.now() >= probeDeadline) break;
    const metricId = candidates[i];
    probesRun++;
    const probe = await fetchWithRetry(
      () =>
        queryValuesReportWithBackoff({
          apiKey: params.apiKey,
          revision: params.revision,
          endpointPath: "/api/campaign-values-reports/",
          timeframeKey: "last_30_days",
          conversionMetricId: metricId,
          filter: "contains-any(send_channel,[\"email\"])",
          statistics: ["recipients", "conversion_value"],
          groupBy: ["send_channel"],
          deadlineAtMs: probeDeadline,
          bucket: params.bucket,
        }),
      1,
    );
    if (!probe.ok) continue;
    if (hasNonZeroConversion(probe.body?.data?.attributes?.results ?? [])) {
      return { metricId, reason: "probe_campaign" as const, probesRun };
    }
  }

  return { metricId: candidates[0] ?? null, reason: "fallback_first_candidate" as const, probesRun };
}

const REVENUE_METRIC_PATTERNS = [
  "placed order",
  "ordered product",
  "order completed",
  "completed order",
  "checkout completed",
  "fulfilled order",
  "purchase",
];

function pickMetricCandidatesFromList(allMetrics: any[]) {
  const nameOf = (m: any) => (m?.attributes?.name ?? "").toLowerCase();
  const integrationOf = (m: any) => (m?.attributes?.integration?.name ?? m?.attributes?.integration?.category ?? "").toLowerCase();
  const shopifyPlacedOrder = allMetrics.filter((m: any) =>
    nameOf(m).includes("placed order") && (integrationOf(m).includes("shopify") || integrationOf(m).includes("api"))
  ).map((m: any) => m.id);
  const anyPlacedOrder = allMetrics.filter((m: any) => nameOf(m).includes("placed order")).map((m: any) => m.id);
  const otherRevenue = allMetrics.filter((m: any) =>
    REVENUE_METRIC_PATTERNS.some((p) => nameOf(m).includes(p))
  ).map((m: any) => m.id);
  const allIds = allMetrics.map((m: any) => m.id);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const id of [...shopifyPlacedOrder, ...anyPlacedOrder, ...otherRevenue, ...allIds]) {
    if (!seen.has(id)) { seen.add(id); candidates.push(id); }
  }
  const findName = (id: string) => {
    const m = allMetrics.find((x: any) => x.id === id);
    return m?.attributes?.name ?? null;
  };
  return { shopifyPlacedOrder, anyPlacedOrder, candidates, findName };
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

// ---------------------------------------------------------------------------
// klaviyo_runs logging (stage-aware)
// ---------------------------------------------------------------------------

async function logStageRun(
  sb: ReturnType<typeof assertServiceClient>,
  row: {
    correlationId: string;
    auditId: string | null;
    clientId: string | null;
    stage: Stage;
    status: "success" | "error" | "partial" | "timeout";
    revision: string | null;
    elapsedMs: number;
    errorCode?: string;
    errorMessage?: string | null;
  },
) {
  try {
    await sb.from("klaviyo_runs").insert({
      correlation_id: row.correlationId,
      audit_id: row.auditId,
      client_id: row.clientId,
      stage: row.stage,
      status: row.status,
      revision: row.revision,
      elapsed_ms: row.elapsedMs,
      error_code: row.errorCode ?? null,
      error_message: row.errorMessage ? row.errorMessage.slice(0, 1000) : null,
    });
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Shared: resolve API key for a client
// ---------------------------------------------------------------------------

async function resolveApiKey(
  sb: ReturnType<typeof assertServiceClient>,
  clientId: string,
  inlineKey: string | null | undefined,
): Promise<string> {
  const inline = (inlineKey ?? "").trim();
  if (inline) {
    const enc = await encryptString(inline);
    await mustSucceed("client_secrets upsert", sb.from("client_secrets").upsert({
      client_id: clientId,
      klaviyo_private_key_ciphertext: enc.ciphertext,
      klaviyo_private_key_iv: enc.iv,
      klaviyo_private_key_alg: enc.alg,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }));
    return inline;
  }
  const { data, error } = await sb.from("client_secrets").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  if (!data?.klaviyo_private_key_ciphertext || !data?.klaviyo_private_key_iv) {
    throw new Error("No Klaviyo key stored for this client");
  }
  return await decryptString(data.klaviyo_private_key_ciphertext, data.klaviyo_private_key_iv);
}

// ---------------------------------------------------------------------------
// Stage 1: config
// ---------------------------------------------------------------------------

async function runStageConfig(params: {
  auditId: string;
  clientId: string;
  apiKeyInline: string | null;
  revision: string;
  profileScan: "full" | "fast";
  correlationId: string;
}): Promise<Response> {
  const startedAt = Date.now();
  const deadlineAtMs = startedAt + 148_000;
  const sb = assertServiceClient();

  try {
    const apiKey = await resolveApiKey(sb, params.clientId, params.apiKeyInline);

    // Account + config fetches.
    const accountRes = await fetchWithRetry(() => klaviyoFetch(apiKey, params.revision, "/api/accounts/"), 3);
    if (!accountRes.ok) {
      const detail =
        (accountRes.body as any)?.errors?.[0]?.detail ??
        (accountRes.body as any)?.error?.message ??
        null;
      await logStageRun(sb, {
        correlationId: params.correlationId,
        auditId: params.auditId,
        clientId: params.clientId,
        stage: "config",
        status: "error",
        revision: params.revision,
        elapsedMs: Date.now() - startedAt,
        errorCode: "invalid_key_or_scope",
        errorMessage: `Account lookup failed (${accountRes.status})${detail ? `: ${detail}` : ""}`,
      });
      return json({
        ok: false,
        error: {
          code: "invalid_key_or_scope",
          status: accountRes.status,
          message: `Account lookup failed (${accountRes.status})${detail ? `: ${detail}` : ""}`,
        },
        correlationId: params.correlationId,
      }, { status: 200 });
    }
    const account = accountRes.body?.data?.[0] ?? null;
    const accountId = account?.id ?? null;
    const accountName = account?.attributes?.contact_information?.organization_name ?? null;
    const websiteUrl = account?.attributes?.contact_information?.website_url ?? null;
    const timezone = account?.attributes?.timezone ?? null;
    const preferredCurrency = account?.attributes?.preferred_currency ?? null;

    const [flows, lists, segments, forms, campaigns, metricsRes] = await Promise.all([
      klaviyoPaged(apiKey, params.revision, "/api/flows/?page%5Bsize%5D=50"),
      klaviyoPaged(apiKey, params.revision, "/api/lists/", MAX_LIST_SEGMENT_PAGES),
      klaviyoPaged(apiKey, params.revision, "/api/segments/", MAX_LIST_SEGMENT_PAGES),
      klaviyoPaged(apiKey, params.revision, "/api/forms/?page%5Bsize%5D=100"),
      klaviyoPaged(apiKey, params.revision, "/api/campaigns/?filter=equals(messages.channel,'email')", MAX_CAMPAIGN_PAGES),
      klaviyoPaged(apiKey, params.revision, "/api/metrics/?fields%5Bmetric%5D=name,integration", METRICS_MAX_PAGES),
    ]);

    // Clear prior snapshots for this audit.
    await mustSucceed("delete klaviyo_flow_snapshots", sb.from("klaviyo_flow_snapshots").delete().eq("audit_id", params.auditId));
    await mustSucceed("delete klaviyo_campaign_snapshots", sb.from("klaviyo_campaign_snapshots").delete().eq("audit_id", params.auditId));
    await mustSucceed("delete klaviyo_form_snapshots", sb.from("klaviyo_form_snapshots").delete().eq("audit_id", params.auditId));
    await mustSucceed("delete klaviyo_segment_snapshots", sb.from("klaviyo_segment_snapshots").delete().eq("audit_id", params.auditId));
    await mustSucceed("delete klaviyo_reporting_rollups", sb.from("klaviyo_reporting_rollups").delete().eq("audit_id", params.auditId));

    if (flows.ok) {
      const rows = flows.items.map((f: any) => ({
        audit_id: params.auditId,
        client_id: params.clientId,
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
      const campaignItems = campaigns.items.slice(0, CAMPAIGN_SNAPSHOT_CAP);
      const rows = campaignItems.map((c: any) => ({
        audit_id: params.auditId,
        client_id: params.clientId,
        campaign_id: c.id,
        name: c.attributes?.name ?? "",
        status: c.attributes?.status ?? "",
        send_channel: c.attributes?.send_channel ?? "email",
        created_at_klaviyo: c.attributes?.created_at ?? null,
        updated_at_klaviyo: c.attributes?.updated_at ?? null,
        raw: c,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_campaign_snapshots", sb.from("klaviyo_campaign_snapshots").insert(rows));

      // Best-effort: grab HTML of most recent sent campaign for email-design comparison.
      try {
        if (deadlineAtMs - Date.now() >= MIN_SLACK_MS_EMAIL_HTML) {
          const sentCampaigns = campaignItems
            .filter((c: any) => (c.attributes?.status ?? "").toLowerCase() === "sent")
            .sort((a: any, b: any) => {
              const da = a.attributes?.updated_at || a.attributes?.created_at || "";
              const db = b.attributes?.updated_at || b.attributes?.created_at || "";
              return db.localeCompare(da);
            });
          const recentCampaign = sentCampaigns[0];
          if (recentCampaign) {
            const msgRes = await klaviyoFetch(apiKey, params.revision, `/api/campaigns/${recentCampaign.id}/campaign-messages/`);
            const messages = msgRes.ok ? (msgRes.body?.data ?? []) : [];
            let emailHtml: string | null = null;
            for (const msg of messages) {
              const htmlBody = msg?.attributes?.content?.html;
              if (htmlBody) { emailHtml = htmlBody; break; }
              const templateId = msg?.relationships?.template?.data?.id;
              if (templateId) {
                const tplRes = await klaviyoFetch(apiKey, params.revision, `/api/templates/${templateId}/`);
                if (tplRes.ok && tplRes.body?.data?.attributes?.html) {
                  emailHtml = tplRes.body.data.attributes.html;
                  break;
                }
              }
            }
            if (emailHtml) {
              await sb.from("audit_email_design").upsert({
                audit_id: params.auditId,
                client_email_html: emailHtml,
                client_campaign_name: recentCampaign.attributes?.name ?? null,
                client_campaign_id: recentCampaign.id,
              }, { onConflict: "audit_id" }).select();
            }
          }
        }
      } catch { /* non-critical */ }
    }

    if (forms.ok) {
      const rows = forms.items.map((f: any) => ({
        audit_id: params.auditId,
        client_id: params.clientId,
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
        audit_id: params.auditId,
        client_id: params.clientId,
        segment_id: s.id,
        name: s.attributes?.name ?? "",
        created_at_klaviyo: s.attributes?.created ?? null,
        updated_at_klaviyo: s.attributes?.updated ?? null,
        raw: s,
      }));
      if (rows.length) await mustSucceed("insert klaviyo_segment_snapshots", sb.from("klaviyo_segment_snapshots").insert(rows));
    }

    // Diagnostic summary + connection metadata.
    function extractKlaviyoError(res: any): string | null {
      if (res.ok) return null;
      const errs = res.body?.errors;
      if (Array.isArray(errs) && errs.length > 0) {
        return errs.map((e: any) => `${e.status ?? ""} ${e.title ?? ""}: ${e.detail ?? ""}`).join("; ").slice(0, 500);
      }
      if (typeof res.body === "string") return res.body.slice(0, 500);
      try { return JSON.stringify(res.body).slice(0, 500); } catch { return "unknown"; }
    }
    const resources = { accounts: accountRes, flows, lists, segments, forms, campaigns, metrics: metricsRes } as Record<string, any>;
    const scopeDiag: Record<string, any> = {};
    for (const [name, res] of Object.entries(resources)) {
      scopeDiag[name] = res.ok ? true : { ok: false, status: res.status ?? null, error: extractKlaviyoError(res) };
    }

    await mustSucceed("upsert klaviyo_connections", sb.from("klaviyo_connections").upsert({
      client_id: params.clientId,
      account_id: accountId,
      account_name: accountName,
      website_url: websiteUrl,
      timezone,
      preferred_currency: preferredCurrency,
      revision: params.revision,
      scopes: scopeDiag,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }));

    if (websiteUrl) {
      const { data: existingClient } = await sb.from("clients").select("website_url").eq("id", params.clientId).maybeSingle();
      if (!existingClient?.website_url) {
        await mustSucceed("update clients.website_url", sb.from("clients").update({ website_url: websiteUrl }).eq("id", params.clientId));
      }
    }
    await mustSucceed("update clients.klaviyo_connected", sb.from("clients").update({ klaviyo_connected: true }).eq("id", params.clientId));

    // Resolve conversion metric: prefer cache, then single unambiguous Shopify "Placed Order", else probe.
    const allMetrics = metricsRes.ok ? metricsRes.items : [];
    const { shopifyPlacedOrder, anyPlacedOrder, candidates: metricCandidates, findName } =
      pickMetricCandidatesFromList(allMetrics);

    let conversionMetricId: string | null = null;
    let conversionMetricName: string | null = null;
    let metricPickReason: string = "none";
    let metricProbesRun = 0;

    // Cache read.
    const { data: conn } = await sb.from("klaviyo_connections")
      .select("conversion_metric_id, conversion_metric_name, conversion_metric_verified_at")
      .eq("client_id", params.clientId).maybeSingle();
    const cachedId = (conn?.conversion_metric_id ?? null) as string | null;
    const cachedVerifiedAtMs = conn?.conversion_metric_verified_at ? Date.parse(String(conn.conversion_metric_verified_at)) : NaN;
    const cacheFresh =
      !!cachedId &&
      Number.isFinite(cachedVerifiedAtMs) &&
      (Date.now() - cachedVerifiedAtMs) < METRIC_CACHE_TTL_MS &&
      allMetrics.some((m: any) => m.id === cachedId);
    if (cacheFresh && cachedId) {
      conversionMetricId = cachedId;
      conversionMetricName = (conn?.conversion_metric_name as string | null) ?? findName(cachedId) ?? null;
      metricPickReason = "cache_hit";
    } else if (shopifyPlacedOrder.length === 1) {
      conversionMetricId = shopifyPlacedOrder[0];
      conversionMetricName = findName(conversionMetricId!) ?? null;
      metricPickReason = "shopify_placed_order_direct";
    } else if (anyPlacedOrder.length === 1 && shopifyPlacedOrder.length === 0) {
      conversionMetricId = anyPlacedOrder[0];
      conversionMetricName = findName(conversionMetricId!) ?? null;
      metricPickReason = "placed_order_direct";
    } else if (metricsRes.ok && metricCandidates.length > 0) {
      const bucket = createReportingBucket({ tokensPerMin: REPORTING_TOKENS_PER_MIN, burst: REPORTING_BURST });
      const flowIds = flows.ok ? flows.items.map((f: any) => f.id) : [];
      const picked = await pickBestConversionMetricId({
        apiKey,
        revision: params.revision,
        candidateMetricIds: metricCandidates,
        flowIds,
        deadlineAtMs,
        bucket,
      });
      conversionMetricId = picked.metricId;
      conversionMetricName = conversionMetricId ? (findName(conversionMetricId) ?? null) : null;
      metricPickReason = picked.reason;
      metricProbesRun = picked.probesRun ?? 0;
    } else {
      metricPickReason = "metrics_fetch_failed";
    }

    if (conversionMetricId) {
      await sb.from("klaviyo_connections").update({
        conversion_metric_id: conversionMetricId,
        conversion_metric_name: conversionMetricName,
        conversion_metric_verified_at: new Date().toISOString(),
      }).eq("client_id", params.clientId);
    }

    const campaignsTruncated = campaigns.ok
      ? (campaigns.truncated || campaigns.items.length > CAMPAIGN_SNAPSHOT_CAP)
      : null;

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Seed reporting rollup shell (counts only); stage 2 fills in report data.
    const timeframeKeys: Array<"last_30_days" | "last_90_days"> = ["last_30_days"];
    const accountSnapshotSeed = {
      email_subscribed_profiles_count: null as number | null,
      active_profiles_90d_count: null as number | null,
      suppressed_profiles_count: null as number | null,
      bounce_rate_90d: null as number | null,
      spam_rate_90d: null as number | null,
      deliverability_campaign_timeframe: "last_30_days",
      active_profiles_definition: "Proxy: email-subscribed profiles updated in last 90 days",
      email_subscribed_profiles_truncated: null as boolean | null,
      active_profiles_90d_truncated: null as boolean | null,
      suppressed_profiles_truncated: null as boolean | null,
      campaigns_truncated: campaignsTruncated,
      profile_scan_status: (params.profileScan === "full" ? "pending" : "skipped") as "pending" | "skipped",
      computed_at: new Date().toISOString(),
    };
    const derivedMetricsSeed = { list_size: 0, monthly_engagement: 0, revenue_per_recipient: null as number | null };
    for (const tf of timeframeKeys) {
      await mustSucceed("insert klaviyo_reporting_rollups seed", sb.from("klaviyo_reporting_rollups").insert({
        audit_id: params.auditId,
        client_id: params.clientId,
        timeframe_key: tf,
        conversion_metric_id: conversionMetricId,
        campaigns: [],
        flows: [],
        computed: {
          counts: {
            flows: flows.ok ? flows.items.length : null,
            campaigns: campaigns.ok ? campaigns.items.length : null,
            forms: forms.ok ? forms.items.length : null,
            segments: segments.ok ? segments.items.length : null,
            lists: lists.ok ? lists.items.length : null,
          },
          reporting_errors: [],
          account_snapshot: accountSnapshotSeed,
          derived_metrics: derivedMetricsSeed,
          metric_selection: { reason: metricPickReason, probes_run: metricProbesRun },
          since90_iso: since90,
          stage: "config_complete",
        },
      }));
    }

    // Chain stage 2 (reporting). Stage 3 (profile) is kicked off by stage 2.
    await chainStage("reporting", params.auditId);

    const failedEndpoints = Object.entries(scopeDiag).filter(([, v]) => v !== true);
    await logStageRun(sb, {
      correlationId: params.correlationId,
      auditId: params.auditId,
      clientId: params.clientId,
      stage: "config",
      status: failedEndpoints.length > 0 ? "partial" : "success",
      revision: params.revision,
      elapsedMs: Date.now() - startedAt,
      errorMessage: failedEndpoints.length > 0 ? JSON.stringify(Object.fromEntries(failedEndpoints)) : null,
    });

    return json({
      ok: true,
      correlationId: params.correlationId,
      stage: "config",
      revision: params.revision,
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
        conversion_metric_name: conversionMetricName,
        conversion_metric_selection: {
          reason: metricPickReason,
          probes_run: metricProbesRun,
          candidates_tested: metricCandidates.slice(0, 10),
        },
        // Stage 2 will fill these in; the frontend should poll klaviyo_runs(stage=reporting).
        campaign_reports: [],
        flow_reports: [],
        errors: [],
        reporting_ok: null,
      },
      account_snapshot: accountSnapshotSeed,
      // Frontend uses this to decide whether to poll klaviyo_profile_scan_jobs.
      // Either way it still polls klaviyo_runs(stage='reporting') for stage 2 completion.
      profile_metrics_status: (params.profileScan === "full" ? "pending" : "complete") as "pending" | "complete",
      derived_metrics: derivedMetricsSeed,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : "Unknown error");
    await logStageRun(sb, {
      correlationId: params.correlationId,
      auditId: params.auditId,
      clientId: params.clientId,
      stage: "config",
      status: "error",
      revision: params.revision,
      elapsedMs: Date.now() - startedAt,
      errorCode: "config_failed",
      errorMessage: msg,
    });
    return json({ ok: false, error: { code: "config_failed", message: msg }, correlationId: params.correlationId }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Stage 2: reporting
// ---------------------------------------------------------------------------

async function runStageReporting(params: {
  auditId: string;
  correlationId: string;
}): Promise<Response> {
  const startedAt = Date.now();
  const deadlineAtMs = startedAt + 148_000;
  const sb = assertServiceClient();

  let clientId: string | null = null;
  let revision: string = DEFAULT_REVISION;
  try {
    const { data: audit, error: auditErr } = await sb.from("audits").select("client_id").eq("id", params.auditId).maybeSingle();
    if (auditErr) throw auditErr;
    if (!audit?.client_id) throw new Error("audit not found");
    clientId = audit.client_id as string;

    const { data: conn } = await sb.from("klaviyo_connections")
      .select("revision, conversion_metric_id")
      .eq("client_id", clientId).maybeSingle();
    revision = (conn?.revision as string | null) || DEFAULT_REVISION;
    const conversionMetricId = (conn?.conversion_metric_id as string | null) || null;

    const apiKey = await resolveApiKey(sb, clientId, null);

    // Reload snapshots + counts from DB (stage 1 persisted them).
    const { data: flowRows } = await sb.from("klaviyo_flow_snapshots")
      .select("flow_id, name, status").eq("audit_id", params.auditId);
    const flowIds = (flowRows ?? []).map((r) => r.flow_id as string);

    const { data: rollups } = await sb.from("klaviyo_reporting_rollups")
      .select("id, timeframe_key, computed").eq("audit_id", params.auditId);
    const timeframeKeys: Array<"last_30_days" | "last_90_days"> = ["last_30_days"];
    const reportingErrors: Array<{ stage: string; status?: number | null; message: string }> = [];

    // Profile-scan mode from stage 1 seed.
    const accountSnapshotSeed = rollups?.[0]?.computed && (rollups[0].computed as any)?.account_snapshot;
    const profileScanFull = (accountSnapshotSeed?.profile_scan_status ?? "skipped") === "pending";
    const since90 = (rollups?.[0]?.computed as any)?.since90_iso
      || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    if (!conversionMetricId) {
      reportingErrors.push({ stage: "metrics_lookup", status: null, message: "No cached conversion_metric_id; run stage=config first." });
    }

    const flowIdsForReport = flowIds.slice(0, MAX_REPORT_IDS);
    const flowFilterForReport = flowIdsForReport.length
      ? `contains-any(flow_id,[${flowIdsForReport.map((id) => JSON.stringify(id)).join(",")}])`
      : undefined;

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

    const bucket = createReportingBucket({ tokensPerMin: REPORTING_TOKENS_PER_MIN, burst: REPORTING_BURST });
    const campaignReports: Array<{ timeframe: "last_30_days" | "last_90_days"; results: any[] }> = [];
    const flowReports: Array<{ timeframe: "last_30_days" | "last_90_days"; results: any[] }> = [];
    let revenuePerRecipient: number | null = null;
    let bounceRate90d: number | null = null;
    let spamRate90d: number | null = null;
    let metricReCacheAt: string | null = null;

    await mustSucceed("delete flow_performance", sb.from("flow_performance").delete().eq("audit_id", params.auditId));

    if (conversionMetricId) {
      // Serialize main reports through the token bucket (2/min steady).
      const tf: "last_30_days" = "last_30_days";
      const camp30 = await queryValuesReportWithBackoff({
        apiKey,
        revision,
        endpointPath: "/api/campaign-values-reports/",
        timeframeKey: tf,
        conversionMetricId,
        filter: "contains-any(send_channel,[\"email\"])",
        statistics: campaignReportStats,
        groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
        deadlineAtMs,
        bucket,
      });
      if (camp30.ok) {
        campaignReports.push({ timeframe: tf, results: camp30.body?.data?.attributes?.results ?? [] });
      } else {
        reportingErrors.push({ stage: `campaign_values_${tf}`, status: camp30.status ?? null, message: trimBody(camp30.body) ?? "Campaign values report failed" });
      }

      const flow30 = await queryValuesReportWithBackoff({
        apiKey,
        revision,
        endpointPath: "/api/flow-values-reports/",
        timeframeKey: tf,
        conversionMetricId,
        filter: flowFilterForReport,
        statistics: flowReportStats,
        groupBy: ["flow_id", "flow_message_id", "send_channel"],
        deadlineAtMs,
        bucket,
      });
      if (flow30.ok) {
        flowReports.push({ timeframe: tf, results: flow30.body?.data?.attributes?.results ?? [] });
      } else {
        reportingErrors.push({ stage: `flow_values_${tf}`, status: flow30.status ?? null, message: trimBody(flow30.body) ?? "Flow values report failed" });
      }

      // 90d campaign for deliverability.
      const camp90 = await queryValuesReportWithBackoff({
        apiKey,
        revision,
        endpointPath: "/api/campaign-values-reports/",
        timeframeKey: "last_90_days",
        conversionMetricId,
        filter: "contains-any(send_channel,[\"email\"])",
        statistics: campaignReportStats,
        groupBy: ["campaign_id", "campaign_message_id", "send_channel"],
        deadlineAtMs,
        bucket,
      });
      if (camp90.ok) {
        campaignReports.push({ timeframe: "last_90_days", results: camp90.body?.data?.attributes?.results ?? [] });
      } else {
        reportingErrors.push({ stage: "campaign_values_last_90_days", status: camp90.status ?? null, message: trimBody(camp90.body) ?? "Campaign values report failed (last_90_days)" });
      }

      // Flow rollup into flow_performance.
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

      const NON_REVENUE_PATTERNS = [
        /review\s*request/i, /review\s*follow/i, /feedback/i, /survey/i, /nps/i,
        /sunset/i, /list\s*clean/i,
        /order\s*confirm/i, /order\s*notif/i,
        /shipping/i, /delivery/i, /fulfillment/i, /transactional/i,
        /password\s*reset/i, /account\s*confirm/i, /double\s*opt/i,
      ];
      const isNonRevenueFlow = (name: string) => NON_REVENUE_PATTERNS.some((p) => p.test(name));

      const flowPerfRows = Object.entries(flowAgg).map(([flowId, a]) => {
        const denom = Math.max(1, a.recipients);
        const actual_open = a.open / denom;
        const actual_click = a.click / denom;
        const actual_conv = a.conv / denom;
        const actual_rpr = a.rpr / denom;
        const flowMeta = (flowRows ?? []).find((f) => f.flow_id === flowId);
        const flowName = flowMeta?.name ?? flowId;
        const flowStatus = ((flowMeta?.status ?? "live") as string).toLowerCase();
        const mappedStatus =
          flowStatus.includes("draft") ? "draft" : flowStatus.includes("paused") ? "paused" : "live";
        const nonRevenue = isNonRevenueFlow(flowName);
        const targetRpr = actual_rpr * 1.15;
        const opportunity = nonRevenue ? 0 : Math.max(0, (targetRpr - actual_rpr) * a.recipients);
        return {
          audit_id: params.auditId,
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
        // If we got 0 rows at all AND stage 1 used a cached metric, invalidate the cache so next run re-probes.
        if (last30.length === 0 && clientId) {
          await sb.from("klaviyo_connections").update({
            conversion_metric_verified_at: null,
          }).eq("client_id", clientId);
          metricReCacheAt = new Date().toISOString();
        }
      }

      function extractBounceSpam(rowsIn: any[]): { bounce: number | null; spam: number | null } {
        if (!Array.isArray(rowsIn) || rowsIn.length === 0) return { bounce: null, spam: null };
        let denom = 0;
        let bounceNum = 0;
        let spamNum = 0;
        for (const row of rowsIn) {
          const stats = row?.statistics ?? {};
          const recipients = Number(stats.recipients ?? 0) || 0;
          const b = Number(stats.bounce_rate ?? NaN);
          const s = Number(stats.spam_complaint_rate ?? NaN);
          if (recipients <= 0) continue;
          denom += recipients;
          if (Number.isFinite(b)) bounceNum += b * recipients;
          if (Number.isFinite(s)) spamNum += s * recipients;
        }
        if (denom > 0) return { bounce: bounceNum / denom, spam: spamNum / denom };
        return { bounce: null, spam: null };
      }
      const camp90Rows = campaignReports.find((r) => r.timeframe === "last_90_days")?.results
        ?? campaignReports.find((r) => r.timeframe === "last_30_days")?.results
        ?? [];
      const deliv = extractBounceSpam(camp90Rows);
      bounceRate90d = deliv.bounce;
      spamRate90d = deliv.spam;
    }

    // Merge into rollups: update existing seeded rows with results.
    const accountSnapshotFinal = {
      ...(accountSnapshotSeed ?? {}),
      bounce_rate_90d: bounceRate90d,
      spam_rate_90d: spamRate90d,
      deliverability_campaign_timeframe: campaignReports.some((r) => r.timeframe === "last_90_days") ? "last_90_days" : "last_30_days",
      profile_scan_status: profileScanFull ? "pending" : "skipped",
      computed_at: new Date().toISOString(),
    };
    const derivedMetricsPartial = {
      list_size: 0,
      monthly_engagement: 0,
      revenue_per_recipient: revenuePerRecipient,
    };

    for (const row of rollups ?? []) {
      const tf = row.timeframe_key as "last_30_days" | "last_90_days";
      const camp = campaignReports.find((r) => r.timeframe === tf)?.results ?? [];
      const flw = flowReports.find((r) => r.timeframe === tf)?.results ?? [];
      const prevComputed = (row.computed ?? {}) as Record<string, unknown>;
      const prevCounts = (prevComputed as any).counts ?? {};
      await mustSucceed("update klaviyo_reporting_rollups", sb.from("klaviyo_reporting_rollups")
        .update({
          campaigns: camp,
          flows: flw,
          computed: {
            ...prevComputed,
            counts: prevCounts,
            reporting_errors: reportingErrors,
            account_snapshot: accountSnapshotFinal,
            derived_metrics: derivedMetricsPartial,
            stage: "reporting_complete",
            metric_re_cache_invalidated_at: metricReCacheAt,
          },
        }).eq("id", row.id));
    }

    if (profileScanFull && clientId) {
      await mustSucceed("upsert klaviyo_profile_scan_jobs", sb.from("klaviyo_profile_scan_jobs").upsert({
        audit_id: params.auditId,
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

      await chainStage("resume_profile_scan", params.auditId);
    } else {
      await chainAuditAnalysis(params.auditId);
    }

    await logStageRun(sb, {
      correlationId: params.correlationId,
      auditId: params.auditId,
      clientId,
      stage: "reporting",
      status: reportingErrors.length ? "partial" : "success",
      revision,
      elapsedMs: Date.now() - startedAt,
      errorMessage: reportingErrors.length ? JSON.stringify(reportingErrors).slice(0, 1000) : null,
    });

    return json({
      ok: true,
      correlationId: params.correlationId,
      stage: "reporting",
      revision,
      reporting: {
        conversion_metric_id: conversionMetricId,
        campaign_reports: campaignReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
        flow_reports: flowReports.map((r) => ({ timeframe: r.timeframe, rows: (r.results ?? []).length })),
        errors: reportingErrors,
        reporting_ok: reportingErrors.length === 0,
      },
      account_snapshot: accountSnapshotFinal,
      derived_metrics: derivedMetricsPartial,
      profile_metrics_status: profileScanFull ? "pending" : "complete",
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : "Unknown error");
    await logStageRun(sb, {
      correlationId: params.correlationId,
      auditId: params.auditId,
      clientId,
      stage: "reporting",
      status: "error",
      revision,
      elapsedMs: Date.now() - startedAt,
      errorCode: "reporting_failed",
      errorMessage: msg,
    });
    return json({ ok: false, error: { code: "reporting_failed", message: msg }, correlationId: params.correlationId }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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

  // Normalize legacy `mode` into `stage`.
  const stage: Stage =
    bodyJson.stage ??
    (bodyJson.mode === "resume_profile_scan" ? "resume_profile_scan" : "config");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: { code: "config_missing", message: "Supabase env missing" }, correlationId }, { status: 500 });
  }

  // Stage-specific auth + dispatch.
  if (stage === "resume_profile_scan" || stage === "reporting" || stage === "profile") {
    // These stages are usually chain-invoked with the service role key; accept either the SR key or a signed-in user (for manual retries).
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

    const auditId = (bodyJson.audit_id ?? "").trim();
    if (!auditId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });
    }

    try {
      if (stage === "resume_profile_scan") {
        return await handleResumeProfileScan(auditId, correlationId);
      }
      if (stage === "reporting") {
        return await runStageReporting({ auditId, correlationId });
      }
      // stage === "profile" — just kicks the resume chain (used by stage 2 and nudges).
      await chainStage("resume_profile_scan", auditId);
      return json({ ok: true, correlationId, stage: "profile", profile_metrics_status: "in_progress" });
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : "Unknown error");
      return json({ ok: false, error: { code: `${stage}_failed`, message: msg }, correlationId }, { status: 500 });
    }
  }

  // stage === "config" — the entry point called by the frontend.
  try {
    await requireAuthenticatedUser(req);
  } catch (e) {
    return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
  }

  const auditId = (bodyJson.audit_id ?? "").trim();
  const clientId = (bodyJson.client_id ?? "").trim();
  if (!auditId || !clientId) {
    return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or client_id" }, correlationId }, { status: 400 });
  }
  const revision = (bodyJson.revision || DEFAULT_REVISION).trim();
  const profileScan: "full" | "fast" = bodyJson.profile_scan === "fast" ? "fast" : "full";

  return await runStageConfig({
    auditId,
    clientId,
    apiKeyInline: bodyJson.api_key ?? null,
    revision,
    profileScan,
    correlationId,
  });
});
