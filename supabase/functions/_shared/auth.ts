import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Whether a bearer token is the service role, by EXACT match against the
 * configured key.
 *
 * This used to also accept any JWT whose payload merely claimed
 * role=service_role, decoding the middle segment WITHOUT verifying the
 * signature: `x.<base64 of {"role":"service_role"}>.x` passed, so anyone could
 * reach every service-tier function that skips the user check.
 *
 * Every legitimate service caller sends the real key: the pipeline functions
 * post `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` and satisfy the exact match. The
 * one exception was the pg_cron watchdog, which reads a service_role key from
 * the vault that is currently STALE against the refreshed env key (proven live:
 * with this path removed, the watchdog returned 401). Rather than reopen the
 * forgery for everyone, the watchdog carries its own scoped fallback inline; see
 * profile_scan_watchdog. Closing that last gap is a vault-key sync away. */
export function isServiceRoleAuthorization(token: string): boolean {
  const expected = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  return Boolean(expected) && token === expected;
}

/** Resolves the signed-in user id using GoTrue (works reliably in Edge; avoids gateway JWT quirks). */
export async function getUserIdFromAuthorization(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.trim()) throw new Error("Missing Authorization header");
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!base) throw new Error("Missing SUPABASE_URL");
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid or expired session");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Auth verification failed (${res.status}): ${t.slice(0, 160)}`);
  }
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) throw new Error("Invalid session");
  return body.id;
}

export function assertServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAdminUserId(req: Request): Promise<string> {
  const uid = await getUserIdFromAuthorization(req);
  const sb = assertServiceRoleClient();
  const { data: profile, error: pErr } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (pErr) throw pErr;
  if (profile?.role !== "admin") throw new Error("Forbidden");
  return uid;
}

/** Like requireAdminUserId but accepts both staff roles (admin, auditor). */
export async function requireStaffUserId(req: Request): Promise<string> {
  const uid = await getUserIdFromAuthorization(req);
  const sb = assertServiceRoleClient();
  const { data: profile, error: pErr } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (pErr) throw pErr;
  if (profile?.role !== "admin" && profile?.role !== "auditor") throw new Error("Forbidden");
  return uid;
}
