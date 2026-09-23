/**
 * Read-only comparison: Klaviyo Audit DB vs unified PTO DB (clients + users).
 * Usage: node scripts/compare-merge-readiness.mjs
 */
import { createClient } from '@supabase/supabase-js';

const AUDIT_URL = process.env.AUDIT_SUPABASE_URL || 'https://wuvqwuviwubthmuncuya.supabase.co';
const AUDIT_KEY = process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY;
const PTO_URL = process.env.PTO_SUPABASE_URL || 'https://alcquoohotkgvhddnzlo.supabase.co';
const PTO_KEY = process.env.PTO_SUPABASE_SERVICE_ROLE_KEY;

if (!AUDIT_KEY || !PTO_KEY) {
  console.error('Set AUDIT_SUPABASE_SERVICE_ROLE_KEY and PTO_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const audit = createClient(AUDIT_URL, AUDIT_KEY, { auth: { persistSession: false } });
const pto = createClient(PTO_URL, PTO_KEY, { auth: { persistSession: false } });

function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normDomain(url) {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

async function listTables(client, label) {
  const tables = [
    'profiles', 'clients', 'audits', 'audit_sections', 'proposals', 'proposal_line_items',
    'proposal_templates', 'platform_settings', 'contract_documents', 'audit_events',
  ];
  const counts = {};
  for (const t of tables) {
    const { count, error: e } = await client.from(t).select('*', { count: 'exact', head: true });
    counts[t] = e ? `ERR: ${e.message}` : count;
  }
  console.log(`\n=== ${label} row counts ===`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
}

async function main() {
  await listTables(audit, 'Audit project');

  const { data: auditClients, error: acErr } = await audit.from('clients').select('*');
  if (acErr) throw acErr;

  const { data: ptoClients, error: pcErr } = await pto.from('clients').select('*');
  if (pcErr) throw pcErr;

  const { data: auditProfiles, error: apErr } = await audit.from('profiles').select('*');
  if (apErr) throw apErr;

  const { data: ptoProfiles, error: ppErr } = await pto.from('profiles').select('id, full_name, role, is_active');
  if (ppErr) throw ppErr;

  const { data: ptoUsers } = await pto.auth.admin.listUsers({ perPage: 200 });
  const ptoEmailById = new Map((ptoUsers?.users || []).map((u) => [u.id, u.email?.toLowerCase()]));

  const { data: auditUsers } = await audit.auth.admin.listUsers({ perPage: 200 });
  const auditEmailById = new Map((auditUsers?.users || []).map((u) => [u.id, u.email?.toLowerCase()]));

  console.log('\n=== Client overlap (by normalized company/name + domain) ===');
  const ptoByName = new Map(ptoClients.map((c) => [normName(c.name), c]));
  const ptoByDomain = new Map(
    ptoClients.filter((c) => c.website).map((c) => [normDomain(c.website), c]),
  );

  let matched = 0;
  let auditOnly = [];
  for (const c of auditClients) {
    const key = normName(c.company_name || c.name);
    const domain = normDomain(c.website_url);
    const byName = ptoByName.get(key) || ptoByName.get(normName(c.name));
    const byDomain = domain ? ptoByDomain.get(domain) : null;
    if (byName || byDomain) {
      matched++;
    } else {
      auditOnly.push(c);
    }
  }
  console.log(`  Audit clients: ${auditClients.length}`);
  console.log(`  PTO/CT clients: ${ptoClients.length}`);
  console.log(`  Likely same client (name or domain): ${matched}`);
  console.log(`  Audit-only (no PTO match): ${auditOnly.length}`);
  if (auditOnly.length) {
    console.log('  Audit-only samples:', auditOnly.slice(0, 8).map((c) => c.company_name || c.name));
  }

  console.log('\n=== User overlap (by email) ===');
  const ptoEmails = new Set([...ptoEmailById.values()].filter(Boolean));
  const auditEmails = [...auditEmailById.values()].filter(Boolean);
  const overlap = auditEmails.filter((e) => ptoEmails.has(e));
  const auditOnlyUsers = auditEmails.filter((e) => !ptoEmails.has(e));
  console.log(`  Audit auth users: ${auditEmails.length}`);
  console.log(`  PTO auth users: ${ptoEmails.size}`);
  console.log(`  Same email in both: ${overlap.length}`);
  console.log(`  Audit-only emails: ${auditOnlyUsers.length}`);
  if (auditOnlyUsers.length) console.log('  ', auditOnlyUsers.slice(0, 10));

  console.log('\n=== Profile schema differences ===');
  console.log('  Audit profiles columns:', auditProfiles[0] ? Object.keys(auditProfiles[0]).join(', ') : 'none');
  console.log('  PTO profiles columns:', ptoProfiles[0] ? Object.keys(ptoProfiles[0]).join(', ') : 'none');

  console.log('\n=== Audit profile roles ===');
  const roleCounts = {};
  for (const p of auditProfiles) roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
  console.log(roleCounts);

  console.log('\n=== Audit clients sample columns ===');
  if (auditClients[0]) console.log(Object.keys(auditClients[0]).join(', '));

  const { count: auditCount } = await audit.from('audits').select('*', { count: 'exact', head: true });
  const { count: proposalCount } = await audit.from('proposals').select('*', { count: 'exact', head: true });
  console.log(`\n=== FK risk ===`);
  console.log(`  Audits referencing clients: ${auditCount}`);
  console.log(`  Proposals referencing clients: ${proposalCount}`);
  console.log('  Merging clients tables blindly would break audit FKs unless IDs are remapped or audit uses CT client_id mapping.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
