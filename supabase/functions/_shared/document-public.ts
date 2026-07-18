import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
// Reuse the generic public-token helpers from the proposals shared module.
export { PROPOSAL_CORS_HEADERS as DOCUMENT_CORS_HEADERS, proposalJson as documentJson, PUBLIC_TOKEN_RE, hashSignedPayload as hashContent } from "./proposal-public.ts";
import { PUBLIC_TOKEN_RE } from "./proposal-public.ts";

export function isDocumentExpired(doc: { status: string; valid_until: string | null }): boolean {
  if (doc.status !== "sent" && doc.status !== "viewed") return false;
  if (!doc.valid_until) return false;
  const validUntil = new Date(`${doc.valid_until}T23:59:59`);
  return Number.isFinite(validUntil.getTime()) && validUntil < new Date();
}

/** Fetch a document by public token with its signature. Returns null for unknown
 * tokens AND drafts (no status oracle). */
export async function fetchPublicDocument(sb: SupabaseClient, token: string) {
  if (!PUBLIC_TOKEN_RE.test(token)) return null;
  const { data: document, error } = await sb
    .from("documents")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!document || document.status === "draft") return null;

  const { data: signatures, error: sigErr } = await sb
    .from("document_signatures")
    .select("id, document_id, signer_name, signer_email, signature_image, typed_name, ip_address, user_agent, signed_at")
    .eq("document_id", document.id)
    .limit(1);
  if (sigErr) throw sigErr;

  return { document, signature: (signatures ?? [])[0] ?? null };
}

/** Public-safe payload: only the fields the recipient-facing page needs. */
export function serializePublicDocument(
  bundle: NonNullable<Awaited<ReturnType<typeof fetchPublicDocument>>>,
) {
  const { document, signature } = bundle;
  return {
    document: {
      id: document.id,
      document_number: document.document_number,
      title: document.title,
      content: document.content,
      status: document.status,
      recipient_name: document.recipient_name,
      recipient_email: document.recipient_email,
    },
    signature,
    signed: Boolean(signature),
    expired: isDocumentExpired(document),
  };
}
