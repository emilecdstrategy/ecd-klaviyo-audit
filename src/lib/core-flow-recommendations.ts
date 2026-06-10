/**
 * Company-standard "Recommended" copy for the Core Flows Matrix.
 * Keep in sync with supabase/functions/_shared/core-flow-recommendations.ts
 */
import {
  CORE_FLOW_MATRIX_NAMES,
  CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION,
} from './core-flows-matrix';

export type CoreFlowRecommendations = Record<string, string>;

export const DEFAULT_CORE_FLOW_RECOMMENDATIONS: CoreFlowRecommendations = {
  'Welcome Series':
    '4-5 emails, where the signup path (email vs. email + SMS) sets the discount served. Add 2 SMS: an instant offer and a final reminder before it expires.',
  'Browse Abandonment':
    '2 emails + 1 SMS. Email 1 reminds with the viewed product (no offer), email 2 adds light urgency, and an SMS nudges a few hours later.',
  'Abandoned Cart':
    '3-4 emails per path (based on purchase history; first-time buyers get a welcome offer), plus up to 2 SMS depending on scope.',
  'Abandoned Checkout':
    '3-4 emails + 1-2 SMS per path (based on purchase history; first-time buyers get a welcome offer) to recover checkouts that stalled at payment.',
  'Post-Purchase':
    'Split by purchase history, 3-4 emails per path to drive the next order and build loyalty.',
  'Subscription Lifecycle':
    'Lifecycle messaging across onboarding, upcoming-charge reminders, and churn/win-back to keep subscribers active and cut cancellations.',
  'Back-in-Stock':
    '1 email + 1 SMS the moment the item returns, so ready buyers convert first.',
  'Winback / Re-engagement':
    '1-2 emails + 1 SMS. Standard is 1 email + 1 SMS, adding a softer first email when scope allows before the urgency send.',
  'Sunset / List Cleaning':
    '1-2 emails over a short window giving disengaged profiles a final chance to re-engage before suppression, protecting deliverability.',
};

export const CORE_FLOW_RECOMMENDATION_FLOW_ORDER = [
  ...CORE_FLOW_MATRIX_NAMES.slice(0, 4),
  'Subscription Lifecycle',
  ...CORE_FLOW_MATRIX_NAMES.slice(4),
] as const;

export function mergeCoreFlowRecommendations(
  stored?: Partial<CoreFlowRecommendations> | null,
): CoreFlowRecommendations {
  const merged = { ...DEFAULT_CORE_FLOW_RECOMMENDATIONS };
  if (!stored || typeof stored !== 'object') return merged;
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'string' && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

export function getCoreFlowRecommendation(
  flowName: string,
  recommendations: CoreFlowRecommendations,
): string {
  return recommendations[flowName]?.trim() ?? '';
}

/** Flow names that always appear in the matrix (subscription row is optional). */
export function getAlwaysOnCoreFlowNames(): readonly string[] {
  return CORE_FLOW_MATRIX_NAMES;
}

export function getAllConfigurableCoreFlowNames(): readonly string[] {
  return CORE_FLOW_RECOMMENDATION_FLOW_ORDER;
}

export { CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION };
