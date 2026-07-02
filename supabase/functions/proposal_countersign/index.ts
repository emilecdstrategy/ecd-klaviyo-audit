// ECD countersign endpoint. Requires a staff (admin/auditor) session; the
// signature insert itself goes through the service role because
// proposal_signatures has no authenticated INSERT policy.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { PROPOSAL_CORS_HEADERS, proposalJson } from "../_shared/proposal-public.ts";

const MAX_SIGNATURE_LENGTH = 300000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PROPOSAL_CORS_HEADERS });
  if (req.method !== "POST") return proposalJson({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    const userId = await requireStaffUserId(req);
    const body = (await req.json().catch(() => ({}))) as {
      proposal_id?: string;
      typed_name?: string;
      signature_image?: string;
    };
    const proposalId = (body.proposal_id ?? "").trim();
    const typedName = (body.typed_name ?? "").trim();
    const signatureImage = body.signature_image ?? "";

    if (!proposalId || !typedName) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Missing proposal_id or typed_name" }, correlationId }, { status: 400 });
    }
    if (!signatureImage.startsWith("data:image/png;base64,") || signatureImage.length > MAX_SIGNATURE_LENGTH) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Please draw your signature" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceRoleClient();
    const { data: proposal, error: pErr } = await sb
      .from("proposals")
      .select("id, client_signed_at, countersigned_at")
      .eq("id", proposalId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proposal) {
      return proposalJson({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    }
    if (!proposal.client_signed_at) {
      return proposalJson({ ok: false, error: { code: "client_not_signed", message: "The client has not signed yet" }, correlationId }, { status: 409 });
    }
    if (proposal.countersigned_at) {
      return proposalJson({ ok: false, error: { code: "already_countersigned" }, correlationId }, { status: 409 });
    }

    const { data: userRow } = await sb.from("profiles").select("email, name").eq("id", userId).maybeSingle();
    const signedAt = new Date().toISOString();

    const { error: sigError } = await sb.from("proposal_signatures").insert({
      proposal_id: proposalId,
      role: "agency",
      signer_name: typedName,
      signer_email: (userRow as { email?: string } | null)?.email ?? "",
      signer_user_id: userId,
      signature_image: signatureImage,
      typed_name: typedName,
      ip_address: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400),
      signed_at: signedAt,
    });
    if (sigError) {
      if ((sigError as { code?: string }).code === "23505") {
        return proposalJson({ ok: false, error: { code: "already_countersigned" }, correlationId }, { status: 409 });
      }
      throw sigError;
    }

    const { error: updateError } = await sb
      .from("proposals")
      .update({ countersigned_at: signedAt, updated_at: signedAt })
      .eq("id", proposalId);
    if (updateError) throw updateError;

    await sb.from("proposal_events").insert({
      proposal_id: proposalId,
      event_type: "countersigned",
      actor: "admin",
      actor_user_id: userId,
      metadata: { typed_name: typedName },
    });

    return proposalJson({ ok: true, signed_at: signedAt, correlationId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "Forbidden" ? 403 : 200;
    return proposalJson({ ok: false, error: { code: "request_failed", message }, correlationId }, { status });
  }
});
