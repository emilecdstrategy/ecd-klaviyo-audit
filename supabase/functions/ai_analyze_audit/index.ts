import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AI_OUTPUT_JSON_SCHEMA,
  AI_SECTIONS_ONLY_SCHEMA,
  AI_TOP_LEVEL_ONLY_SCHEMA,
  AI_SCHEMA_VERSION,
  AUDIT_SECTION_KEYS,
  type SectionKey,
  type ValidationMode,
  failedSectionKeysFromErrors,
  validateOutput,
} from "./schema.ts";
import { buildAuditSystemPrompt, buildAuditUserPrompt, buildRepairUserPrompt, type KlaviyoContext } from "./prompts.ts";

type WizardData = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const PRIMARY_MODEL = "gpt-5.4";
const ESCALATION_MODEL = "gpt-5.4-pro";
// Supabase Edge Functions support up to 150s. Give OpenAI plenty of headroom.
const MAX_ATTEMPTS = 1;
const REQUEST_TIMEOUT_MS = 120_000;

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function jsonCors(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

async function requireAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing Authorization header");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Invalid session");
  return data.user;
}

function timeoutSignal(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

function errToMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

function extractOutputText(resBody: any): string {
  if (typeof resBody?.output_text === "string" && resBody.output_text.trim()) return resBody.output_text;
  const chunks = (resBody?.output ?? [])
    .flatMap((o: any) => o?.content ?? [])
    .map((c: any) => c?.text)
    .filter((t: unknown) => typeof t === "string");
  return chunks.join("\n");
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
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function decryptString(ciphertextB64: string, ivB64: string) {
  const secret = (KMS_ENCRYPTION_KEY || SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret) throw new Error("Encryption secret is missing");
  const key = await deriveAesKey(secret);
  const iv = b64decode(ivB64);
  const ct = b64decode(ciphertextB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function getOpenAiKey(): Promise<string> {
  const envKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (envKey) return envKey;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("app_secrets")
    .select("ciphertext, iv")
    .eq("key", "openai_api_key")
    .maybeSingle();
  if (error) throw error;
  if (!data?.ciphertext || !data?.iv) throw new Error("OPENAI_API_KEY is missing");
  return await decryptString(data.ciphertext, data.iv);
}

async function callOpenAI(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: unknown;
}): Promise<{ output: unknown; usage: any }> {
  const OPENAI_API_KEY = await getOpenAiKey();

  const body = {
    model: params.model,
    reasoning: { effort: "medium" },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: params.systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: params.userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "audit_analysis",
        schema: params.jsonSchema ?? AI_OUTPUT_JSON_SCHEMA,
      },
    },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { signal, clear } = timeoutSignal(REQUEST_TIMEOUT_MS);
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      clear();

      const textBody = await res.text();
      let parsed: any = null;
      try {
        parsed = textBody ? JSON.parse(textBody) : null;
      } catch {
        parsed = { raw: textBody };
      }
      if (!res.ok) {
        const msg = parsed?.error?.message ?? `OpenAI request failed (${res.status})`;
        throw new Error(`${msg} (status ${res.status})`);
      }

      const outText = extractOutputText(parsed);
      if (!outText) throw new Error("OpenAI response missing output_text");
      let output: unknown;
      try {
        output = JSON.parse(outText);
      } catch (e) {
        throw new Error(`Failed to parse OpenAI JSON output: ${errToMessage(e)}`);
      }
      return { output, usage: parsed?.usage ?? null };
    } catch (e) {
      const msg = errToMessage(e);
      lastErr = msg === "timeout" ? new Error("OpenAI request timed out") : e;
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`OpenAI call failed: ${errToMessage(lastErr)}`);
}

async function fetchKlaviyoContext(auditId: string, clientId: string): Promise<KlaviyoContext | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [connRes, flowsRes, campaignsRes, segmentsRes, formsRes, perfRes] = await Promise.all([
    sb.from("klaviyo_connections").select("account_name, timezone, website_url").eq("client_id", clientId).maybeSingle(),
    sb.from("klaviyo_flow_snapshots").select("name, status, trigger_type").eq("audit_id", auditId),
    sb.from("klaviyo_campaign_snapshots").select("name, status, send_channel, created_at_klaviyo, updated_at_klaviyo").eq("audit_id", auditId),
    sb.from("klaviyo_segment_snapshots").select("name, created_at_klaviyo, updated_at_klaviyo").eq("audit_id", auditId),
    sb.from("klaviyo_form_snapshots").select("name, status").eq("audit_id", auditId),
    sb.from("flow_performance").select("flow_name, flow_status, recipients_per_month, actual_open_rate, actual_click_rate, actual_conv_rate, monthly_revenue_current").eq("audit_id", auditId),
  ]);

  const hasData = (flowsRes.data?.length ?? 0) > 0 || (campaignsRes.data?.length ?? 0) > 0 ||
                  (segmentsRes.data?.length ?? 0) > 0 || (formsRes.data?.length ?? 0) > 0;
  if (!hasData) return null;

  return {
    account: connRes.data ? { name: connRes.data.account_name, timezone: connRes.data.timezone, website_url: connRes.data.website_url } : undefined,
    flows: (flowsRes.data ?? []).map((f: any) => ({ name: f.name, status: f.status, trigger_type: f.trigger_type })),
    campaigns: (campaignsRes.data ?? []).map((c: any) => ({ name: c.name, status: c.status, send_channel: c.send_channel, created_at: c.created_at_klaviyo, updated_at: c.updated_at_klaviyo })),
    segments: (segmentsRes.data ?? []).map((s: any) => ({ name: s.name, created: s.created_at_klaviyo, updated: s.updated_at_klaviyo })),
    forms: (formsRes.data ?? []).map((f: any) => ({ name: f.name, status: f.status })),
    flowPerformance: (perfRes.data ?? []).map((fp: any) => ({
      flow_name: fp.flow_name, flow_status: fp.flow_status,
      recipients_per_month: fp.recipients_per_month, actual_open_rate: fp.actual_open_rate,
      actual_click_rate: fp.actual_click_rate, actual_conv_rate: fp.actual_conv_rate,
      monthly_revenue_current: fp.monthly_revenue_current,
    })),
  };
}

async function logRun(payload: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.from("ai_runs").insert(payload);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonCors({ error: "Method not allowed" }, { status: 405 });

  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();
  let selectedModel = PRIMARY_MODEL;
  let retries = 0;

  try {
    try {
      await requireAuthenticatedUser(req);
    } catch (e) {
      // Important: return 200 so supabase-js doesn't surface a non-2xx transport error.
      // The client handles ok:false responses and can show a friendly message.
      return jsonCors(
        { ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId },
        { status: 200 },
      );
    }

    const body = (await req.json()) as WizardData;
    const requestedSectionKeys: SectionKey[] | null = Array.isArray((body as any)?.requestedSectionKeys)
      ? ((body as any).requestedSectionKeys as SectionKey[]).filter((k) => (AUDIT_SECTION_KEYS as readonly string[]).includes(k))
      : null;
    const explicitMode = (body as any)?.aiMode as ValidationMode | undefined;
    let mode: ValidationMode = "full";
    if (explicitMode === "top_level_only" || explicitMode === "sections_only" || explicitMode === "full") {
      mode = explicitMode;
    } else if ((body as any)?.sectionsOnly === true) {
      mode = "sections_only";
    }
    const selectedSchema =
      mode === "top_level_only"
        ? AI_TOP_LEVEL_ONLY_SCHEMA
        : mode === "sections_only"
          ? AI_SECTIONS_ONLY_SCHEMA
          : AI_OUTPUT_JSON_SCHEMA;
    const requiredKeys = requestedSectionKeys?.length ? requestedSectionKeys : AUDIT_SECTION_KEYS;
    const systemPrompt = buildAuditSystemPrompt();

    // Fetch Klaviyo snapshot data from DB to enrich the prompt
    let klaviyoCtx: KlaviyoContext | null = null;
    const auditId = (body as any)?.auditId;
    const clientId = (body as any)?.clientId;
    if (auditId && clientId) {
      try {
        klaviyoCtx = await fetchKlaviyoContext(auditId, clientId);
      } catch {
        // Non-critical: proceed without snapshot data
      }
    }

    const first = await callOpenAI({
      model: PRIMARY_MODEL,
      systemPrompt,
      userPrompt: buildAuditUserPrompt(body, klaviyoCtx ?? undefined, mode),
      jsonSchema: selectedSchema,
    });

    let output = first.output;
    let usage = first.usage;
    let validation = validateOutput(output, requiredKeys, mode);

    if (!validation.ok) {
      const failedSections = failedSectionKeysFromErrors(validation.errors);
      if (failedSections.length > 0) {
        // Avoid long multi-call repair loops inside a single edge invocation.
        // If validation fails, surface errors to the client so we can retry deterministically.
        selectedModel = ESCALATION_MODEL;
        retries += 1;
      }
    }

    if (!validation.ok) {
      await logRun({
        correlation_id: correlationId,
        status: "validation_failed",
        model: selectedModel,
        retries,
        elapsed_ms: Date.now() - startedAt,
        error_code: "validation_failed",
        error_message: validation.errors.join("; ").slice(0, 1000),
      });
      return jsonCors(
        {
          ok: false,
          error: {
            code: "validation_failed",
            message: "AI output validation failed",
            details: validation.errors,
          },
          correlationId,
        },
        { status: 200 },
      );
    }

    await logRun({
      correlation_id: correlationId,
      status: "success",
      model: selectedModel,
      retries,
      elapsed_ms: Date.now() - startedAt,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      schema_version: AI_SCHEMA_VERSION,
    });

    return jsonCors(
      {
        ok: true,
        correlationId,
        schemaVersion: AI_SCHEMA_VERSION,
        executiveSummary: validation.value.executiveSummary,
        strengths: validation.value.strengths ?? [],
        concerns: validation.value.concerns ?? [],
        implementationTimeline: validation.value.implementationTimeline ?? [],
        sections: validation.value.sections,
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = errToMessage(e);
    const code = /timeout/i.test(msg) ? "provider_timeout" : "provider_error";
    await logRun({
      correlation_id: correlationId,
      status: "error",
      model: selectedModel,
      retries,
      elapsed_ms: Date.now() - startedAt,
      error_code: code,
      error_message: msg.slice(0, 1000),
    });
    return jsonCors(
      {
        ok: false,
        error: { code, message: msg },
        correlationId,
      },
      { status: 200 },
    );
  }
});
