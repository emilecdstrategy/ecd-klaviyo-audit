// Client signing endpoint. Deployed with --no-verify-jwt (anonymous clients).
// Validates the token + proposal state server-side with the service role,
// inserts the signature, recomputes totals for the event record, and
// transitions the proposal to won once all required signers have signed
// (1 signer normally, 2 when a second signer is configured).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient } from "../_shared/auth.ts";
import {
  PROPOSAL_CORS_HEADERS,
  buildSignedPayloadSnapshot,
  computeProposalTotals,
  fetchPublicProposal,
  hashSignedPayload,
  isProposalExpired,
  proposalJson,
  requiredClientSigners,
} from "../_shared/proposal-public.ts";
import { proposalEmailHtml, resolveFromAddress, resolveOrigin, sendEmail } from "../_shared/mailer.ts";
import { escapeHtml, proposalReferenceLink } from "../_shared/proposal-links.ts";

const MAX_SIGNATURE_LENGTH = 300000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PROPOSAL_CORS_HEADERS });
  if (req.method !== "POST") return proposalJson({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      typed_name?: string;
      signer_email?: string;
      signature_image?: string;
    };
    const token = (body.token ?? "").trim().toLowerCase();
    const typedName = (body.typed_name ?? "").trim();
    const signerEmail = (body.signer_email ?? "").trim();
    const signatureImage = body.signature_image ?? "";

    if (!typedName) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Please type your full name" }, correlationId }, { status: 400 });
    }
    if (!EMAIL_RE.test(signerEmail)) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Please enter a valid email address" }, correlationId }, { status: 400 });
    }
    if (!signatureImage.startsWith("data:image/png;base64,") || signatureImage.length > MAX_SIGNATURE_LENGTH) {
      return proposalJson({ ok: false, error: { code: "bad_request", message: "Please draw your signature" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceRoleClient();
    const bundle = await fetchPublicProposal(sb, token);
    if (!bundle) {
      return proposalJson({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    }

    const { proposal, signerIndex, lineItems, signatures } = bundle;
    if (proposal.status !== "sent" && proposal.status !== "viewed") {
      return proposalJson({ ok: false, error: { code: "already_signed" }, correlationId }, { status: 409 });
    }
    if (isProposalExpired(proposal)) {
      return proposalJson({ ok: false, error: { code: "expired" }, correlationId }, { status: 410 });
    }
    const alreadySignedMine = signatures.some(
      (s) => s.role === "client" && (s.signer_index ?? 1) === signerIndex,
    );
    if (alreadySignedMine) {
      return proposalJson({ ok: false, error: { code: "already_signed" }, correlationId }, { status: 409 });
    }

    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 400);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const signedAt = new Date().toISOString();

    const { error: sigError } = await sb.from("proposal_signatures").insert({
      proposal_id: proposal.id,
      role: "client",
      signer_index: signerIndex,
      signer_name: typedName,
      signer_email: signerEmail,
      signature_image: signatureImage,
      typed_name: typedName,
      ip_address: ip,
      user_agent: userAgent,
      signed_at: signedAt,
    });
    if (sigError) {
      // UNIQUE (proposal_id, role, signer_index) is the double-sign race guard.
      if ((sigError as { code?: string }).code === "23505") {
        return proposalJson({ ok: false, error: { code: "already_signed" }, correlationId }, { status: 409 });
      }
      throw sigError;
    }

    // Completion check: recount client signatures fresh (after our own insert has
    // committed) so two concurrent signers can never both conclude they're waiting.
    // A benign double-update to won is idempotent.
    const required = requiredClientSigners(proposal);
    const { count: clientSigCount, error: countError } = await sb
      .from("proposal_signatures")
      .select("id", { count: "exact", head: true })
      .eq("proposal_id", proposal.id)
      .eq("role", "client");
    if (countError) throw countError;
    const complete = (clientSigCount ?? 0) >= required;

    // Server-verified totals frozen into the legal record of the signing.
    const totals = computeProposalTotals(lineItems, proposal);
    const payloadSnapshot = buildSignedPayloadSnapshot(proposal, lineItems, totals);
    const payloadHash = await hashSignedPayload(payloadSnapshot);

    if (complete) {
      const { error: updateError } = await sb
        .from("proposals")
        .update({
          status: "won",
          client_signed_at: signedAt,
          won_at: signedAt,
          updated_at: signedAt,
        })
        .eq("id", proposal.id);
      if (updateError) throw updateError;
    }

    await sb.from("proposal_events").insert([
      {
        proposal_id: proposal.id,
        event_type: "signed",
        actor: "client",
        metadata: {
          ip,
          user_agent: userAgent,
          signer_index: signerIndex,
          signer_email: signerEmail,
          typed_name: typedName,
          totals,
          payload_hash: payloadHash,
          payload_hash_algo: "sha256",
        },
      },
      ...(complete
        ? [{
          proposal_id: proposal.id,
          event_type: "won",
          actor: "system",
          metadata: { via: "client_signature" },
        }]
        : []),
    ]);

    // Team notification (best effort; signing already succeeded).
    const { data: settingsRow } = await sb
      .from("platform_settings")
      .select("proposal_settings")
      .eq("id", "default")
      .maybeSingle();
    const settings = (settingsRow?.proposal_settings ?? {}) as {
      email?: { from_name?: string; from_email?: string; team_notification_emails?: string[] };
    };
    const teamEmails = (settings.email?.team_notification_emails ?? []).filter(Boolean);
    if (teamEmails.length > 0) {
      const origin = resolveOrigin(req);
      const company = proposal.client?.company_name ?? "a client";
      const proposalUrl = origin ? `${origin}/proposals/${proposal.id}` : null;
      const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
      const signerLink = `<a href="mailto:${escapeHtml(signerEmail)}" style="color:#4b3afe;text-decoration:underline;">${escapeHtml(signerEmail)}</a>`;
      await sendEmail({
        to: teamEmails,
        from: resolveFromAddress(settings.email),
        subject: complete
          ? `🎉 Proposal signed by ${company}`
          : `Proposal partially signed by ${company} (${clientSigCount ?? 1} of ${required})`,
        html: proposalEmailHtml({
          heading: complete
            ? `${escapeHtml(typedName)} signed the ${escapeHtml(company)} proposal`
            : `${escapeHtml(typedName)} signed the ${escapeHtml(company)} proposal (${clientSigCount ?? 1} of ${required} signers)`,
          bodyLines: complete
            ? [
              `${proposalReferenceLink(origin, proposal)} was just signed by ${signerLink} and marked won.`,
              `Totals: ${money(totals.oneTimeTotal)} one-time plus ${money(totals.monthlyTotal)}/mo.`,
              ...(proposalUrl ? [] : [`Next step: countersign it from the proposal page.`]),
            ]
            : [
              `${proposalReferenceLink(origin, proposal)} was just signed by ${signerLink}.`,
              `Waiting on the remaining signer before the proposal is marked won.`,
              `Totals: ${money(totals.oneTimeTotal)} one-time plus ${money(totals.monthlyTotal)}/mo.`,
            ],
          ctaLabel: complete && proposalUrl ? "Countersign now" : undefined,
          ctaUrl: complete && proposalUrl ? proposalUrl : undefined,
          logoUrl: origin ? `${origin}/favicon.png` : undefined,
        }),
      });
    }

    return proposalJson({ ok: true, signed_at: signedAt, complete, correlationId });
  } catch (e) {
    return proposalJson(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
