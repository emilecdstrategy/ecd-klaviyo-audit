import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
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

function serviceClient(authHeader?: string | null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
  });
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing Authorization header");
  const sb = serviceClient(authHeader);
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Unauthorized");
  const uid = data.user.id;
  const { data: profile, error: pErr } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (pErr) throw pErr;
  if (profile?.role !== "admin") throw new Error("Forbidden");
  return { uid };
}

type Role = "admin" | "viewer";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    await requireAdmin(req);
    const body = (await req.json()) as
      | { action: "list" }
      | { action: "invite"; email: string }
      | { action: "update_role"; user_id: string; role: Role }
      | { action: "remove"; user_id: string };

    const sb = serviceClient();

    if (body.action === "list") {
      const { data: profs, error } = await sb
        .from("profiles")
        .select("id,email,name,role,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return json({ ok: true, users: profs ?? [] });
    }

    if (body.action === "invite") {
      const email = body.email.trim().toLowerCase();
      if (!email.endsWith("@ecdigitalstrategy.com")) {
        return json({ ok: false, error: { code: "bad_request", message: "Email must be @ecdigitalstrategy.com" } }, { status: 200 });
      }
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email);
      if (error) throw error;

      // Ensure profile exists (default role: viewer)
      const invitedId = data.user?.id;
      if (invitedId) {
        await sb.from("profiles").upsert(
          { id: invitedId, email, name: email.split("@")[0], role: "viewer" },
          { onConflict: "id" },
        );
      }
      return json({ ok: true });
    }

    if (body.action === "update_role") {
      const role = body.role;
      if (!["admin", "viewer"].includes(role)) {
        return json({ ok: false, error: { code: "bad_request", message: "Invalid role" } }, { status: 200 });
      }
      const { error } = await sb.from("profiles").update({ role }).eq("id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "remove") {
      // Remove profile first (non-fatal if missing)
      await sb.from("profiles").delete().eq("id", body.user_id);
      const { error } = await sb.auth.admin.deleteUser(body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Invalid action" } }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } },
      { status: 200 },
    );
  }
});

