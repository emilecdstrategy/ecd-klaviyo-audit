import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Hands a fully signed proposal to the Client Tracker (ct.ecdigitalstrategy.com),
// which runs new-client onboarding: tracker row, pod confirmation, Drive folder,
// Slack channel, Asana board, Everhour, kickoff post. The tracker lives in the
// ECD Hub project, so this is a plain HTTPS call with a shared key.
//
// Best effort by design, like the Xero invoice: a slow or broken tracker must
// never delay or fail a client's signature. The tracker de-duplicates on the
// proposal id, so a retry can never onboard the same client twice.

type ProposalRow = {
  id: string;
  title?: string | null;
  client_id?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  client?: { company_name?: string | null; website_url?: string | null } | null;
};

type LineItemRow = {
  name: string;
  description?: string | null;
  // numeric columns can arrive as strings
  one_time_price?: number | string | null;
  monthly_price?: number | string | null;
};

function price(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function sendSignedProposalToTracker(
  sb: SupabaseClient,
  args: {
    proposal: ProposalRow;
    lineItems: LineItemRow[];
    signedAt: string;
    signerName: string;
    signerEmail?: string | null;
    publicUrl: string | null;
  },
): Promise<void> {
  const url = Deno.env.get("HUB_ONBOARDING_URL") ?? "";
  const key = Deno.env.get("ONBOARDING_SHARED_KEY") ?? "";
  if (!url || !key) return;

  const { proposal } = args;
  let hubspotCompanyId: string | null = null;
  if (proposal.client_id) {
    const { data } = await sb.from("clients").select("hubspot_company_id").eq("id", proposal.client_id).maybeSingle();
    hubspotCompanyId = (data as { hubspot_company_id?: string | null } | null)?.hubspot_company_id ?? null;
  }

  const contacts = [{ name: proposal.recipient_name ?? args.signerName, email: proposal.recipient_email ?? null }];
  const body = {
    action: "start",
    proposal: {
      proposal_id: proposal.id,
      proposal_title: proposal.title ?? "",
      proposal_url: args.publicUrl,
      signed_at: args.signedAt,
      signed_by_name: args.signerName,
      signer_email: args.signerEmail ?? null,
      company_name: proposal.client?.company_name ?? proposal.title ?? "New client",
      website: proposal.client?.website_url ?? null,
      hubspot_company_id: hubspotCompanyId,
      contacts,
      line_items: args.lineItems.map((li) => ({
        name: li.name,
        description: li.description ?? null,
        one_time_price: price(li.one_time_price),
        monthly_price: price(li.monthly_price),
      })),
    },
  };

  await Promise.race([
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-onboarding-key": key },
      body: JSON.stringify(body),
    }).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}
