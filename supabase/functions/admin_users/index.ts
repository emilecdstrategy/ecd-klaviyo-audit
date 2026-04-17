import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireAdminUserId } from "../_shared/auth.ts";

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

type Role = "admin" | "viewer";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    await requireAdminUserId(req);
    const body = (await req.json()) as
      | { action: "list" }
      | { action: "invite"; email: string }
      | { action: "update_role"; user_id: string; role: Role }
      | { action: "remove"; user_id: string };

    const sb = assertServiceRoleClient();

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
      if (!email || !email.includes("@")) {
        return json({ ok: false, error: { code: "bad_request", message: "Please enter a valid email address" } }, { status: 200 });
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

