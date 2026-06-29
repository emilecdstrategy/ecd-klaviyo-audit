/**
 * Backfill segment definitions, group name map, and campaign audiences for an existing audit.
 * Usage: node scripts/backfill-segment-definitions.mjs <audit_id>
 */
const auditId = process.argv[2];
if (!auditId) {
  console.error('Usage: node scripts/backfill-segment-definitions.mjs <audit_id>');
  process.exit(1);
}

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

async function main() {
  console.log(`Backfilling segment definitions for audit ${auditId}…`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/klaviyo_fetch_snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ stage: 'backfill_segment_definitions', audit_id: auditId }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!data?.ok) {
    throw new Error(data?.error?.message ?? `Backfill failed (${res.status}): ${text.slice(0, 500)}`);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
