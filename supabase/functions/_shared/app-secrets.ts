import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KMS_ENCRYPTION_KEY = Deno.env.get("KMS_ENCRYPTION_KEY") ?? "";

// Env vars take precedence over app_secrets rows (useful for local testing).
const ENV_OVERRIDES: Record<string, string> = {
  openai_api_key: "OPENAI_API_KEY",
  anthropic_api_key: "ANTHROPIC_API_KEY",
  hubspot_private_app_token: "HUBSPOT_PRIVATE_APP_TOKEN",
};

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

/** Fetch a secret: env var override first, then AES-GCM-encrypted app_secrets row. */
export async function getSecret(name: string): Promise<string> {
  const envName = ENV_OVERRIDES[name];
  if (envName) {
    const envValue = Deno.env.get(envName) ?? "";
    if (envValue) return envValue;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("app_secrets")
    .select("ciphertext, iv")
    .eq("key", name)
    .maybeSingle();
  if (error) throw error;
  if (!data?.ciphertext || !data?.iv) throw new Error(`Secret ${name} is not configured`);
  return await decryptString(data.ciphertext, data.iv);
}
