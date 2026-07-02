// Send (or resend) a proposal to the client. Staff-only. Handles the full
// go-live transition server-side: token generation, contract snapshot,
// validity window, draft -> sent. Email delivery is optional — without
// RESEND_API_KEY the transition still happens and the link is returned.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { PROPOSAL_CORS_HEADERS, proposalJson } from "../_shared/proposal-public.ts";
import { proposalEmailHtml, resolveFromAddress, sendEmail } from "../_shared/resend.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PROPOSAL_CORS_HEADERS });
  if (req.method !== "POST") return proposalJson({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    const userId = await requireStaffUserId(req);
    const body = (await req.json().catch(() => ({}))) as {
      proposal_id?: string;
      recipient_email?: string;
      recipient_name?: string;
      message?: string;
      app_url?: string;
    };
    const proposalId = (body.proposal_id ?? "").trim();
    const recipientEmail = (body.recipient_email ?? "").trim();
    const recipientName = (body.recipient_name ?? "").trim();
    const message = (body.message ?? "").trim();

    if (!proposalId) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Missing proposal_id" }, correlationId }, { status: 400 });
    }
    if (!EMAIL_RE.test(recipientEmail)) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Valid recipient email required" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceRoleClient();
    const { data: proposal, error: pErr } = await sb
      .from("proposals")
      .select("*, client:clients(company_name)")
      .eq("id", proposalId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proposal) {
      return proposalJson({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    }
    if (proposal.status === "won" || proposal.status === "lost") {
      return proposalJson({ ok: false, error: { code: "closed", message: "Proposal is already closed" }, correlationId }, { status: 409 });
    }

    const { data: settingsRow } = await sb
      .from("platform_settings")
      .select("proposal_settings")
      .eq("id", "default")
      .maybeSingle();
    const settings = (settingsRow?.proposal_settings ?? {}) as {
      email?: { from_name?: string; from_email?: string; reply_to?: string };
      defaults?: { valid_days?: number };
    };

    // Go-live transition (idempotent for resends).
    const token = proposal.public_token ?? generateToken();
    const validDays = settings.defaults?.valid_days || 30;
    const validUntil = proposal.valid_until ??
      new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const wasDraft = proposal.status === "draft";
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = {
      public_token: token,
      valid_until: validUntil,
      recipient_email: recipientEmail,
      updated_at: now,
    };
    if (recipientName) updates.recipient_name = recipientName;
    if (wasDraft) {
      updates.status = "sent";
      updates.sent_at = now;
    }

    // Refresh the contract snapshot while unsigned so contract edits reach the client.
    if (!proposal.client_signed_at) {
      const includeContracts = (proposal.include_contracts ?? []) as string[];
      const { data: docs } = await sb
        .from("contract_documents")
        .select("slug, name, content, updated_at")
        .in("slug", includeContracts.length ? includeContracts : ["__none__"]);
      updates.contracts_snapshot = (docs ?? []).map((doc) => ({
        slug: doc.slug,
        name: doc.name,
        content: doc.content,
        version_updated_at: doc.updated_at,
      }));
    }

    const { error: updateErr } = await sb.from("proposals").update(updates).eq("id", proposalId);
    if (updateErr) throw updateErr;

    const origin = (body.app_url ?? "").trim() || (Deno.env.get("APP_URL") ?? "").trim() || (req.headers.get("origin") ?? "").trim();
    const proposalUrl = `${origin.replace(/\/$/, "")}/proposal/${token}`;
    const companyName = proposal.client?.company_name ?? "your company";

    const emailResult = await sendEmail({
      to: [recipientEmail],
      from: resolveFromAddress(settings.email),
      replyTo: settings.email?.reply_to ?? undefined,
      subject: `Proposal for ${companyName} — ECD Digital Strategy`,
      html: proposalEmailHtml({
        heading: `Your proposal is ready`,
        bodyLines: [
          `Hi${recipientName ? ` ${recipientName.split(" ")[0]}` : ""},`,
          ...(message ? [message] : []),
          `Please review the proposal we prepared for ${companyName}. You can read and sign it directly from the link below.`,
          ...(validUntil ? [`This proposal is valid until ${validUntil}.`] : []),
        ],
        ctaLabel: "View & sign proposal",
        ctaUrl: proposalUrl,
      }),
    });

    await sb.from("proposal_events").insert({
      proposal_id: proposalId,
      event_type: wasDraft ? "sent" : "resent",
      actor: "admin",
      actor_user_id: userId,
      metadata: {
        email_to: recipientEmail,
        email_status: emailResult.status,
        ...(emailResult.status === "sent" ? { resend_id: emailResult.id } : { email_note: emailResult.reason }),
      },
    });

    if (emailResult.status === "failed") {
      return proposalJson(
        { ok: false, error: { code: "email_failed", message: emailResult.reason }, public_token: token, correlationId },
        { status: 200 },
      );
    }

    return proposalJson({
      ok: true,
      public_token: token,
      email_status: emailResult.status,
      ...(emailResult.status === "skipped" ? { email_note: emailResult.reason } : {}),
      correlationId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "Forbidden" ? 403 : 200;
    return proposalJson({ ok: false, error: { code: "request_failed", message }, correlationId }, { status });
  }
});
