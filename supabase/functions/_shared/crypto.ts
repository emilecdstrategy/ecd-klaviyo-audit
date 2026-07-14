/**
 * AES-256-GCM helpers for encrypting client secrets at rest.
 * Same scheme as the inline copies in klaviyo_connect_client / klaviyo_fetch_snapshot.
 */

export function b64encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

export function b64decode(b64: string) {
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
  const kms = (Deno.env.get("KMS_ENCRYPTION_KEY") ?? "").trim();
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  return kms || service;
}

export async function encryptString(plaintext: string) {
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

export async function decryptString(ciphertextB64: string, ivB64: string) {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Encryption secret is missing");
  const key = await deriveAesKey(secret);
  const iv = b64decode(ivB64);
  const ct = b64decode(ciphertextB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
