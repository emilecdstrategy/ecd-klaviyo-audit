// Send (or resend) a document to its recipient. Staff-only. Handles the go-live
// transition (token, validity, draft -> sent) and one email with a signing link.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { DOCUMENT_CORS_HEADERS, documentJson } from "../_shared/document-public.ts";
import { proposalEmailHtml, resolveFromAddress, sendEmail } from "../_shared/mailer.ts";
import { escapeHtml } from "../_shared/proposal-links.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: DOCUMENT_CORS_HEADERS });
  if (req.method !== "POST") return documentJson({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    const userId = await requireStaffUserId(req);
    const body = (await req.json().catch(() => ({}))) as {
      document_id?: string;
      recipient_email?: string;
      recipient_name?: string;
      message?: string;
      app_url?: string;
      reply_to_emails?: string[];
    };
    const documentId = (body.document_id ?? "").trim();
    const recipientEmail = (body.recipient_email ?? "").trim();
    const recipientName = (body.recipient_name ?? "").trim();
    const message = (body.message ?? "").trim();
    const replyToEmails = (body.reply_to_emails ?? []).map((e) => e.trim()).filter((e) => EMAIL_RE.test(e));

    if (!documentId) return documentJson({ ok: false, error: { code: "bad_request", message: "Missing document_id" }, correlationId }, { status: 400 });
    if (!EMAIL_RE.test(recipientEmail)) return documentJson({ ok: false, error: { code: "bad_request", message: "Valid recipient email required" }, correlationId }, { status: 400 });

    const sb = assertServiceRoleClient();
    const { data: document, error: dErr } = await sb.from("documents").select("*").eq("id", documentId).maybeSingle();
    if (dErr) throw dErr;
    if (!document) return documentJson({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    if (document.status === "signed" || document.status === "void") {
      return documentJson({ ok: false, error: { code: "closed", message: "This document is already closed." }, correlationId }, { status: 409 });
    }

    const { data: settingsRow } = await sb
      .from("platform_settings")
      .select("document_settings")
      .eq("id", "default")
      .maybeSingle();
    const settings = (settingsRow?.document_settings ?? {}) as {
      email?: { from_name?: string; from_email?: string; reply_to?: string };
      defaults?: { valid_days?: number };
    };

    const token = document.public_token ?? generateToken();
    const validDays = settings.defaults?.valid_days || 0;
    const validUntil = document.valid_until ??
      (validDays > 0 ? new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10) : null);
    const wasDraft = document.status === "draft";
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
    const { error: updErr } = await sb.from("documents").update(updates).eq("id", documentId);
    if (updErr) throw updErr;

    const origin = (body.app_url ?? "").trim() || (Deno.env.get("APP_URL") ?? "").trim() || (req.headers.get("origin") ?? "").trim();
    const cleanOrigin = origin.replace(/\/$/, "");
    const logoUrl = cleanOrigin ? `${cleanOrigin}/cropped-favicon-192x192.webp` : undefined;

    const [primaryReplyTo, ...ccReplyTos] = replyToEmails.length
      ? replyToEmails
      : settings.email?.reply_to
      ? [settings.email.reply_to]
      : [];

    const subject = `Please review and sign: ${document.title || "a document"}`;
    const bodyLines = [
      `Hi${recipientName ? ` ${escapeHtml(recipientName.split(" ")[0])}` : ""},`,
      ...(message ? [escapeHtml(message)] : []),
      `Please review the document "${escapeHtml(document.title || "Untitled")}" and sign it directly from the link below.`,
      ...(validUntil ? [`This document is available to sign until ${validUntil}.`] : []),
    ];

    const result = await sendEmail({
      to: [recipientEmail],
      from: resolveFromAddress(settings.email),
      replyTo: primaryReplyTo,
      cc: ccReplyTos,
      subject,
      html: proposalEmailHtml({
        heading: "A document is ready for your signature",
        bodyLines,
        ctaLabel: "Review & sign",
        ctaUrl: `${cleanOrigin}/document/${token}`,
        logoUrl,
      }),
    });

    await sb.from("document_events").insert({
      document_id: documentId,
      event_type: wasDraft ? "sent" : "resent",
      actor: "admin",
      actor_user_id: userId,
      metadata: {
        send_method: "email",
        email_to: recipientEmail,
        email_status: result.status,
        subject,
        message: message || null,
        recipient: { name: recipientName || null, email: recipientEmail },
        reply_to: primaryReplyTo || null,
        cc: ccReplyTos,
        body_lines: bodyLines,
        cta_label: "Review & sign",
      },
    });

    if (result.status === "failed") {
      return documentJson(
        { ok: false, error: { code: "email_failed", message: result.reason }, public_token: token, correlationId },
        { status: 200 },
      );
    }

    return documentJson({
      ok: true,
      public_token: token,
      email_status: result.status,
      ...(result.status === "skipped" ? { email_note: result.reason } : {}),
      correlationId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message === "Forbidden" ? 403 : 200;
    return documentJson({ ok: false, error: { code: "request_failed", message }, correlationId }, { status });
  }
});
