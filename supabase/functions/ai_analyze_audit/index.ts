import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AI_OUTPUT_JSON_SCHEMA,
  AI_SCHEMA_VERSION,
  failedSectionKeysFromErrors,
  validateOutput,
} from "./schema.ts";
import { buildAuditSystemPrompt, buildAuditUserPrompt, buildRepairUserPrompt } from "./prompts.ts";

type WizardData = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const PRIMARY_MODEL = "gpt-5.4";
const ESCALATION_MODEL = "gpt-5.4-pro";
// Edge Functions have execution limits; keep OpenAI calls bounded so we don't get terminated mid-run.
const MAX_ATTEMPTS = 1;
const REQUEST_TIMEOUT_MS = 25_000;

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
        schema: AI_OUTPUT_JSON_SCHEMA,
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

      const parsed = await res.json();
      if (!res.ok) {
        const msg = parsed?.error?.message ?? `OpenAI request failed (${res.status})`;
        throw new Error(msg);
      }

      const text = extractOutputText(parsed);
      if (!text) throw new Error("OpenAI response missing output_text");
      return { output: JSON.parse(text), usage: parsed?.usage ?? null };
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI call failed");
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
      return jsonCors(
        { ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId },
        { status: 401 },
      );
    }

    const body = (await req.json()) as WizardData;
    const systemPrompt = buildAuditSystemPrompt();

    const first = await callOpenAI({
      model: PRIMARY_MODEL,
      systemPrompt,
      userPrompt: buildAuditUserPrompt(body),
    });

    let output = first.output;
    let usage = first.usage;
    let validation = validateOutput(output);

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
      return json(
        {
          ok: false,
          error: {
            code: "validation_failed",
            message: "AI output validation failed",
            details: validation.errors,
          },
          correlationId,
        },
        { status: 422 },
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
        sections: validation.value.sections,
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
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
      { status: 500 },
    );
  }
});
