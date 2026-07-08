import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireAdminUserId } from "../_shared/auth.ts";
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
  // Prefer dedicated KMS key; fall back to service role key to keep the app usable.
  // Service role key never leaves the function runtime.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    await requireAdminUserId(req);
    const body = (await req.json()) as {
      action?: "set" | "status";
      provider?: "openai" | "anthropic";
      api_key?: string;
      openai_api_key?: string;
    };

    const sb = assertServiceRoleClient();
    const provider = body.provider === "anthropic" ? "anthropic" : "openai";
    const secretKey = provider === "anthropic" ? "anthropic_api_key" : "openai_api_key";

    if (body.action === "status") {
      const { data, error } = await sb.from("app_secrets").select("key, updated_at").eq("key", secretKey).maybeSingle();
      if (error) throw error;
      return json({ ok: true, configured: Boolean(data?.key), updated_at: data?.updated_at ?? null });
    }

    if (body.action === "set") {
      const key = (body.api_key ?? body.openai_api_key ?? "").trim();
      if (!key) return json({ ok: false, error: { code: "bad_request", message: "Missing api_key" } }, { status: 400 });
      const enc = await encryptString(key);
      const { error } = await sb.from("app_secrets").upsert(
        { key: secretKey, ciphertext: enc.ciphertext, iv: enc.iv, alg: enc.alg, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Invalid action" } }, { status: 400 });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});

