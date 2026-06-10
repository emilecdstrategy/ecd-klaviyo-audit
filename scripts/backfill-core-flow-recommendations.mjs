/**
 * Overwrite Core Flows Matrix recommended_structure from platform standards on all API audits.
 * Usage:
 *   node scripts/backfill-core-flow-recommendations.mjs
 *   node scripts/backfill-core-flow-recommendations.mjs <audit_id>
 */
const auditIdArg = process.argv[2] || null;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://wuvqwuviwubthmuncuya.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
};

const DEFAULT_CORE_FLOW_RECOMMENDATIONS = {
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

const ALWAYS_ON_FLOW_NAMES = [
  'Abandoned Cart',
  'Abandoned Checkout',
  'Browse Abandonment',
  'Welcome Series',
  'Post-Purchase',
  'Winback / Re-engagement',
  'Back-in-Stock',
  'Sunset / List Cleaning',
];

const SUBSCRIPTION_FLOW_NAME = 'Subscription Lifecycle';

function mergeCoreFlowRecommendations(stored) {
  const merged = { ...DEFAULT_CORE_FLOW_RECOMMENDATIONS };
  if (!stored || typeof stored !== 'object') return merged;
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
  }
  return merged;
}

function emptyRow(name) {
  return {
    flow_name: name,
    present: false,
    live: false,
    email_count: null,
    current_structure_note: '',
    recommended_structure: '',
  };
}

function applyCoreFlowRecommendations(sectionDetails, recommendations) {
  if (!sectionDetails || typeof sectionDetails !== 'object' || Array.isArray(sectionDetails)) {
    return sectionDetails;
  }

  const details = { ...sectionDetails };
  const flows = details.flows;
  if (!flows || typeof flows !== 'object' || Array.isArray(flows)) return details;

  const flowsObj = { ...flows };
  const existing = Array.isArray(flowsObj.core_flows) ? flowsObj.core_flows : [];
  const byName = new Map();

  for (const row of existing) {
    const name = String(row?.flow_name ?? '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { ...row, flow_name: name });
  }

  const includeSubscription = byName.has(SUBSCRIPTION_FLOW_NAME)
    || existing.some(row => String(row?.flow_name ?? '').toLowerCase().includes('subscription'));

  const template = includeSubscription
    ? [...ALWAYS_ON_FLOW_NAMES.slice(0, 4), SUBSCRIPTION_FLOW_NAME, ...ALWAYS_ON_FLOW_NAMES.slice(4)]
    : [...ALWAYS_ON_FLOW_NAMES];

  flowsObj.core_flows = template.map(name => {
    const row = byName.get(name) ?? emptyRow(name);
    return {
      ...row,
      flow_name: name,
      recommended_structure: recommendations[name]?.trim() ?? '',
    };
  });

  details.flows = flowsObj;
  return details;
}

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const settingsRows = await rest('/rest/v1/platform_settings?id=eq.default&select=core_flow_recommendations');
  const recommendations = mergeCoreFlowRecommendations(settingsRows?.[0]?.core_flow_recommendations);

  let auditIds = [];
  if (auditIdArg) {
    auditIds = [auditIdArg];
  } else {
    const audits = await rest('/rest/v1/audits?audit_method=eq.api&select=id');
    auditIds = (audits ?? []).map(a => a.id);
  }

  console.log(`Backfilling ${auditIds.length} API audit(s)...`);

  let updated = 0;
  let skipped = 0;

  for (const auditId of auditIds) {
    const sections = await rest(
      `/rest/v1/audit_sections?audit_id=eq.${auditId}&section_key=eq.flows&select=id,section_details`,
    );
    const section = sections?.[0];
    if (!section?.id || !section.section_details) {
      skipped += 1;
      continue;
    }

    const nextDetails = applyCoreFlowRecommendations(section.section_details, recommendations);
    await rest(`/rest/v1/audit_sections?id=eq.${section.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ section_details: nextDetails }),
      headers: { Prefer: 'return=minimal' },
    });
    updated += 1;
    console.log(`Updated flows section for audit ${auditId}`);
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
