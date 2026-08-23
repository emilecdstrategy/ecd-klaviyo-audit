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

// admin: everything including this function. auditor ("Member" in the UI):
// works in the areas app_access grants. viewer: legacy read-only.
type Role = "admin" | "auditor" | "viewer";
type AppAccess = { audits?: boolean; proposals?: boolean; documents?: boolean };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    const callerId = await requireAdminUserId(req);
    const body = (await req.json()) as
      | { action: "list" }
      | { action: "invite"; email: string }
      | { action: "update_role"; user_id: string; role: Role }
      | { action: "update_access"; user_id: string; app_access: AppAccess }
      | { action: "update_name"; user_id: string; name: string }
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

      // New invites start as MEMBERS with all three areas (the column default),
      // per the decision of 2026-08-14: they can work everywhere from day one
      // and an admin unchecks areas per person. They do not start as viewers
      // (locked out of everything) or as admins (able to manage users).
      const invitedId = data.user?.id;
      if (invitedId) {
        await sb.from("profiles").upsert(
          { id: invitedId, email, name: email.split("@")[0], role: "auditor" },
          { onConflict: "id" },
        );
      }
      return json({ ok: true });
    }

    if (body.action === "update_role") {
      const role = body.role;
      // 'viewer' is retired from the UI (2026-08-14): it was the pre-roles
      // read-only value and nobody holds it. Legacy rows would still render
      // (treated as members with no access), but new assignments are only
      // admin or member.
      if (!["admin", "auditor"].includes(role)) {
        return json({ ok: false, error: { code: "bad_request", message: "Invalid role" } }, { status: 200 });
      }
      // An admin demoting THEMSELVES is the classic lockout: with one admin
      // left, nobody could manage users ever again. Demoting someone else to
      // the last-admin position is impossible by construction (you must be an
      // admin to call this), so guarding self-demotion is sufficient.
      if (body.user_id === callerId && role !== "admin") {
        return json({ ok: false, error: { code: "bad_request", message: "You cannot remove your own admin role. Ask another admin to change it." } }, { status: 200 });
      }
      const { error } = await sb.from("profiles").update({ role }).eq("id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "update_access") {
      const raw = (body.app_access ?? {}) as Record<string, unknown>;
      // Only the three known areas, coerced to booleans; anything else is
      // dropped so the column cannot accumulate junk keys.
      const app_access = {
        audits: raw.audits !== false,
        proposals: raw.proposals !== false,
        documents: raw.documents !== false,
      };
      const { error } = await sb.from("profiles").update({ app_access }).eq("id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "update_name") {
      const name = body.name.trim();
      if (!name) {
        return json({ ok: false, error: { code: "bad_request", message: "Name cannot be empty" } }, { status: 200 });
      }
      const { error } = await sb.from("profiles").update({ name }).eq("id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "remove") {
      // The same lockout update_role guards against, by a different door: an
      // admin deleting their own account (possibly the last one) leaves nobody
      // able to manage users ever again. Block self-removal outright, and block
      // removing the last remaining admin even when it is someone else.
      if (body.user_id === callerId) {
        return json({ ok: false, error: { code: "bad_request", message: "You cannot remove your own account. Ask another admin to do it." } }, { status: 200 });
      }
      const { data: target } = await sb.from("profiles").select("role").eq("id", body.user_id).maybeSingle();
      if (target?.role === "admin") {
        const { count: adminCount } = await sb
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin");
        if ((adminCount ?? 0) <= 1) {
          return json({ ok: false, error: { code: "bad_request", message: "This is the last admin. Promote another admin before removing this one." } }, { status: 200 });
        }
      }
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

