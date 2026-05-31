/**
 * Backfill account_snapshot.deliverability for an existing audit (non-destructive).
 * Usage: node scripts/backfill-audit-deliverability.mjs <audit_id>
 */
const auditId = process.argv[2];
if (!auditId) {
  console.error('Usage: node scripts/backfill-audit-deliverability.mjs <audit_id>');
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
  console.log(`Backfilling deliverability for audit ${auditId}…`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/klaviyo_fetch_snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ stage: 'backfill_deliverability', audit_id: auditId }),
  });
  const data = await res.json();
  if (!data?.ok) {
    throw new Error(data?.error?.message ?? `Backfill failed (${res.status})`);
  }
  console.log('Deliverability:', JSON.stringify(data.deliverability, null, 2));
  if (data.errors?.length) {
    console.warn('Partial errors:', data.errors);
  }
  console.log('Done in', data.elapsed_ms, 'ms');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
