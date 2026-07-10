// Public proposal fetch by token. Deployed with --no-verify-jwt: anonymous
// clients call this with only the anon apikey. All data access uses the
// service role after validating the token server-side (proposal tables have
// no anon RLS policies by design).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, getUserIdFromAuthorization } from "../_shared/auth.ts";
import {
  PROPOSAL_CORS_HEADERS,
  fetchPublicProposal,
  isProposalExpired,
  proposalJson,
  serializePublicProposal,
} from "../_shared/proposal-public.ts";
import { proposalEmailHtml, resolveFromAddress, resolveOrigin, sendEmail } from "../_shared/mailer.ts";
import { escapeHtml, proposalReferenceLink } from "../_shared/proposal-links.ts";

// Email link scanners (Outlook SafeLinks, security proxies) prefetch URLs and
// would otherwise flip proposals to "viewed" before a human opens them.
const SCANNER_UA_RE = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|urldefense|headless/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: PROPOSAL_CORS_HEADERS });
  if (req.method !== "POST") return proposalJson({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    const { token } = (await req.json().catch(() => ({}))) as { token?: string; preview?: boolean };
    const cleanToken = (token ?? "").trim().toLowerCase();

    const sb = assertServiceRoleClient();
    const bundle = await fetchPublicProposal(sb, cleanToken);
    if (!bundle) {
      return proposalJson({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    }

    const { proposal } = bundle;
    const userAgent = req.headers.get("user-agent") ?? "";
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

    // A view from any signed-in ECD session is us checking the proposal, not the
    // client, so it must never flip the status to "viewed" or log a client view.
    // Clients have no app login, so a resolvable session means staff. This covers
    // opening the live client link while logged in, not just the explicit preview.
    let isStaffView = false;
    try {
      await getUserIdFromAuthorization(req);
      isStaffView = true;
    } catch {
      isStaffView = false;
    }

    const isScanner = SCANNER_UA_RE.test(userAgent);

    if (!isStaffView && !isScanner) {
      // Race-safe first-view transition: only one concurrent request wins the
      // sent -> viewed update (M4 hangs the team notification off this winner).
      const { data: transitioned } = await sb
        .from("proposals")
        .update({ status: "viewed", first_viewed_at: new Date().toISOString() })
        .eq("id", proposal.id)
        .eq("status", "sent")
        .select("id");
      const firstView = Boolean(transitioned && transitioned.length > 0);
      if (firstView) {
        proposal.status = "viewed";
      }

      await sb.from("proposal_events").insert({
        proposal_id: proposal.id,
        event_type: "viewed",
        actor: "client",
        metadata: { ip, user_agent: userAgent.slice(0, 400), first_view: firstView, signer_index: bundle.signerIndex },
      });

      // Team notification exactly once, hung off the race-winning first view.
      if (firstView) {
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
          await sendEmail({
            to: teamEmails,
            from: resolveFromAddress(settings.email),
            subject: `Proposal viewed by ${company}`,
            html: proposalEmailHtml({
              heading: `${escapeHtml(company)} just opened their proposal`,
              bodyLines: [
                `${proposalReferenceLink(origin, proposal)} was viewed for the first time.`,
              ],
              logoUrl: origin ? `${origin}/cropped-favicon-192x192.webp` : undefined,
            }),
          });
        }
      }
    }

    const payload = await serializePublicProposal(sb, bundle);
    return proposalJson({ ok: true, ...payload, expired: isProposalExpired(proposal), correlationId });
  } catch (e) {
    return proposalJson(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
