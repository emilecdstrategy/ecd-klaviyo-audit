/** Keep in sync with src/lib/core-flow-recommendations.ts */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type CoreFlowRecommendations = Record<string, string>;

export const DEFAULT_CORE_FLOW_RECOMMENDATIONS: CoreFlowRecommendations = {
  "Welcome Series":
    "4-5 emails, where the signup path (email vs. email + SMS) sets the discount served. Add 2 SMS: an instant offer and a final reminder before it expires.",
  "Browse Abandonment":
    "2 emails + 1 SMS. Email 1 reminds with the viewed product (no offer), email 2 adds light urgency, and an SMS nudges a few hours later.",
  "Abandoned Cart":
    "3-4 emails per path (based on purchase history; first-time buyers get a welcome offer), plus up to 2 SMS depending on scope.",
  "Abandoned Checkout":
    "3-4 emails + 1-2 SMS per path (based on purchase history; first-time buyers get a welcome offer) to recover checkouts that stalled at payment.",
  "Post-Purchase":
    "Split by purchase history, 3-4 emails per path to drive the next order and build loyalty.",
  "Subscription Lifecycle":
    "Lifecycle messaging across onboarding, upcoming-charge reminders, and churn/win-back to keep subscribers active and cut cancellations.",
  "Back-in-Stock":
    "1 email + 1 SMS the moment the item returns, so ready buyers convert first.",
  "Winback / Re-engagement":
    "1-2 emails + 1 SMS. Standard is 1 email + 1 SMS, adding a softer first email when scope allows before the urgency send.",
  "Sunset / List Cleaning":
    "1-2 emails over a short window giving disengaged profiles a final chance to re-engage before suppression, protecting deliverability.",
};

const ALWAYS_ON_FLOW_NAMES = [
  "Abandoned Cart",
  "Abandoned Checkout",
  "Browse Abandonment",
  "Welcome Series",
  "Post-Purchase",
  "Winback / Re-engagement",
  "Back-in-Stock",
  "Sunset / List Cleaning",
] as const;

const SUBSCRIPTION_FLOW_NAME = "Subscription Lifecycle";

export function mergeCoreFlowRecommendations(
  stored?: Partial<CoreFlowRecommendations> | null,
): CoreFlowRecommendations {
  const merged = { ...DEFAULT_CORE_FLOW_RECOMMENDATIONS };
  if (!stored || typeof stored !== "object") return merged;
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string" && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

export async function fetchCoreFlowRecommendations(
  sb: SupabaseClient,
): Promise<CoreFlowRecommendations> {
  const { data, error } = await sb
    .from("platform_settings")
    .select("core_flow_recommendations")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return mergeCoreFlowRecommendations(
    data?.core_flow_recommendations as Partial<CoreFlowRecommendations> | null,
  );
}

type CoreFlowRow = {
  flow_name?: string;
  present?: boolean;
  live?: boolean;
  email_count?: number | null;
  current_structure_note?: string;
  recommended_structure?: string;
};

function emptyRow(name: string): CoreFlowRow {
  return {
    flow_name: name,
    present: false,
    live: false,
    email_count: null,
    current_structure_note: "",
    recommended_structure: "",
  };
}

/** Apply company-standard recommended_structure to flows section_details. */
export function applyCoreFlowRecommendationsToSectionDetails(
  sectionDetails: unknown,
  recommendations: CoreFlowRecommendations,
): Record<string, unknown> | null {
  if (!sectionDetails || typeof sectionDetails !== "object" || Array.isArray(sectionDetails)) {
    return sectionDetails as Record<string, unknown> | null;
  }

  const details = { ...(sectionDetails as Record<string, unknown>) };
  const flows = details.flows;
  if (!flows || typeof flows !== "object" || Array.isArray(flows)) return details;

  const flowsObj = { ...(flows as Record<string, unknown>) };
  const existing = Array.isArray(flowsObj.core_flows)
    ? (flowsObj.core_flows as CoreFlowRow[])
    : [];

  const byName = new Map<string, CoreFlowRow>();
  for (const row of existing) {
    const name = String(row.flow_name ?? "").trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { ...row, flow_name: name });
  }

  const includeSubscription = byName.has(SUBSCRIPTION_FLOW_NAME)
    || existing.some((row) => String(row.flow_name ?? "").toLowerCase().includes("subscription"));

  const template = includeSubscription
    ? [...ALWAYS_ON_FLOW_NAMES.slice(0, 4), SUBSCRIPTION_FLOW_NAME, ...ALWAYS_ON_FLOW_NAMES.slice(4)]
    : [...ALWAYS_ON_FLOW_NAMES];

  flowsObj.core_flows = template.map((name) => {
    const row = byName.get(name) ?? emptyRow(name);
    return {
      ...row,
      flow_name: name,
      recommended_structure: recommendations[name]?.trim() ?? "",
    };
  });

  details.flows = flowsObj;
  return details;
}
