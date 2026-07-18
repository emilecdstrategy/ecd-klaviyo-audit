// Build a compact "what we know about this client" dossier from existing
// structured data (client record + recent proposals + latest audit + chosen
// revenue add-ons). Injected into the system prompt every turn when a client is
// known. Also exposes a fuller history payload for the get_client_history tool.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DOSSIER_CHAR_CAP = 4000;

function money(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `$${v.toLocaleString("en-US")}` : "";
}

function pricingOf(li: any): string {
  const once = money(li?.one_time_price);
  const mo = money(li?.monthly_price);
  return [once ? `${once} once` : "", mo ? `${mo}/mo` : ""].filter(Boolean).join(" + ");
}

function addOnsFromLayout(layout: any): string[] {
  const items = layout?.revenue_summary?.blocks?.addOns?.items;
  if (!Array.isArray(items)) return [];
  return items.map((a: any) => a?.name).filter((n: any) => typeof n === "string" && n.trim());
}

/** Compact prompt-ready dossier, or null if the client is unknown. */
export async function buildClientDossier(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data: client } = await sb
    .from("clients")
    .select("company_name, industry, esp_platform, notes, website_url, klaviyo_connected, shopify_connected")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  const lines: string[] = [];
  lines.push(`Client: ${client.company_name}${client.industry ? ` (${client.industry})` : ""}`);
  if (client.website_url) lines.push(`Website: ${client.website_url}`);
  const conns = [
    client.klaviyo_connected ? "Klaviyo connected" : null,
    client.shopify_connected ? "Shopify connected" : null,
  ].filter(Boolean);
  if (conns.length) lines.push(conns.join(", "));
  if (typeof client.notes === "string" && client.notes.trim()) {
    lines.push(`Notes: ${client.notes.trim().slice(0, 800)}`);
  }

  const { data: props } = await sb
    .from("proposals")
    .select("title, status, created_at, line_items:proposal_line_items(name, one_time_price, monthly_price)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (Array.isArray(props) && props.length) {
    lines.push("\nPast proposals (newest first):");
    for (const p of props as any[]) {
      const items = Array.isArray(p.line_items) ? p.line_items : [];
      const itemStr = items
        .slice(0, 6)
        .map((li: any) => {
          const price = pricingOf(li);
          return price ? `${li.name} (${price})` : li.name;
        })
        .filter(Boolean)
        .join("; ");
      lines.push(`- ${p.title} [${p.status}]${itemStr ? `: ${itemStr}` : ""}`);
    }
  }

  const { data: audits } = await sb
    .from("audits")
    .select("title, total_revenue_opportunity, context, layout, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  const audit = (audits ?? [])[0] as any;
  if (audit) {
    lines.push("\nLatest audit:");
    const rev = money(audit.total_revenue_opportunity);
    if (rev) lines.push(`- Revenue opportunity identified: ${rev}`);
    const ctx = (audit.context ?? {}) as any;
    if (typeof ctx.client_background === "string" && ctx.client_background.trim()) {
      lines.push(`- Background: ${ctx.client_background.trim().slice(0, 600)}`);
    }
    if (typeof ctx.meeting_notes === "string" && ctx.meeting_notes.trim()) {
      lines.push(`- Meeting notes: ${ctx.meeting_notes.trim().slice(0, 600)}`);
    }
    const addOns = addOnsFromLayout(audit.layout);
    if (addOns.length) lines.push(`- Recommended add-ons: ${addOns.slice(0, 8).join(", ")}`);
  }

  return lines.join("\n").slice(0, DOSSIER_CHAR_CAP);
}

/** Fuller structured history for the get_client_history tool. */
export async function fetchClientHistory(sb: SupabaseClient, clientId: string): Promise<unknown> {
  const { data: client } = await sb
    .from("clients")
    .select("company_name, industry, esp_platform, notes, website_url")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "client_not_found" };

  const { data: props } = await sb
    .from("proposals")
    .select("title, status, created_at, content_blocks, line_items:proposal_line_items(name, description, one_time_price, one_time_label, monthly_price, monthly_label)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: audits } = await sb
    .from("audits")
    .select("title, total_revenue_opportunity, context, layout, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(2);

  return {
    client: {
      company_name: client.company_name,
      industry: client.industry ?? null,
      esp_platform: client.esp_platform ?? null,
      website_url: client.website_url ?? null,
      notes: typeof client.notes === "string" ? client.notes.slice(0, 1500) : "",
    },
    proposals: (props ?? []).map((p: any) => ({
      title: p.title,
      status: p.status,
      created_at: p.created_at,
      section_titles: Array.isArray(p.content_blocks) ? p.content_blocks.map((b: any) => b?.title).filter(Boolean) : [],
      line_items: (Array.isArray(p.line_items) ? p.line_items : []).map((li: any) => ({
        name: li?.name,
        description: li?.description,
        one_time_price: li?.one_time_price ?? null,
        one_time_label: li?.one_time_label ?? null,
        monthly_price: li?.monthly_price ?? null,
        monthly_label: li?.monthly_label ?? null,
      })),
    })),
    audits: (audits ?? []).map((a: any) => ({
      title: a.title,
      total_revenue_opportunity: a.total_revenue_opportunity ?? null,
      background: typeof a.context?.client_background === "string" ? a.context.client_background.slice(0, 1200) : "",
      meeting_notes: typeof a.context?.meeting_notes === "string" ? a.context.meeting_notes.slice(0, 1200) : "",
      recommended_add_ons: addOnsFromLayout(a.layout),
    })),
  };
}
