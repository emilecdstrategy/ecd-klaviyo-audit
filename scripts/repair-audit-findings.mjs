/**
 * One-off repair for audits with split executive-summary findings/concerns.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/repair-audit-findings.mjs 52d12b492ea94f2a95f36fa8
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://wuvqwuviwubthmuncuya.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const token = process.argv[2];
if (!token) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/repair-audit-findings.mjs <public_share_token>');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

function isFindingContinuation(prev, next) {
  const p = prev.trim();
  const n = next.trim();
  if (!p || !n) return false;
  if (/^[a-z]{1,8}(\*\*)?[,\s]/.test(n)) return true;
  const boldCount = (p.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1 && /^[a-z]/.test(n)) return true;
  if (/[a-zA-Z]$/.test(p) && !/[.!?]$/.test(p)) {
    if (/^[a-z]/.test(n)) return true;
    if (/ [A-Z]$/.test(p)) return true;
  }
  return false;
}

function mergeFindingContinuation(prev, next) {
  const p = prev.trimEnd();
  const n = next.trimStart();
  if (/[a-zA-Z]$/.test(p) && /^[a-z]/.test(n)) return p + n;
  return `${p} ${n}`;
}

function repairBrokenBoldMarkers(text) {
  const count = (text.match(/\*\*/g) ?? []).length;
  return count % 2 === 1 ? `${text}**` : text;
}

function repairSplitFindings(items) {
  const raw = items.map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const item of raw) {
    if (out.length === 0) {
      out.push(item);
      continue;
    }
    const prev = out[out.length - 1];
    if (isFindingContinuation(prev, item)) {
      out[out.length - 1] = repairBrokenBoldMarkers(mergeFindingContinuation(prev, item));
    } else {
      out.push(item);
    }
  }
  return out.map(repairBrokenBoldMarkers);
}

function resolveExecutiveFindings(findings, concerns) {
  const base =
    Array.isArray(findings) && findings.some((f) => f.trim())
      ? findings
      : Array.isArray(concerns)
        ? concerns
        : [];
  return repairSplitFindings(base).slice(0, 5);
}

async function main() {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const fetchUrl = `${SUPABASE_URL}/rest/v1/audits?public_share_token=eq.${encodeURIComponent(token)}&select=id,executive_summary`;
  const rows = await fetch(fetchUrl, { headers }).then((r) => r.json());
  const audit = rows?.[0];
  if (!audit) {
    console.error('Audit not found for token:', token);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(audit.executive_summary || '{}');
  } catch {
    console.error('executive_summary is not JSON — nothing to repair');
    process.exit(1);
  }

  const repairedFindings = resolveExecutiveFindings(payload.findings, payload.concerns);
  const repairedConcerns = repairSplitFindings(payload.concerns ?? []);
  const nextPayload = {
    ...payload,
    findings: repairedFindings,
    concerns: repairedConcerns,
  };

  const patchUrl = `${SUPABASE_URL}/rest/v1/audits?id=eq.${audit.id}`;
  const res = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ executive_summary: JSON.stringify(nextPayload) }),
  });

  if (!res.ok) {
    console.error('Update failed:', res.status, await res.text());
    process.exit(1);
  }

  console.log('Repaired audit', audit.id);
  console.log('Findings:');
  for (const [i, f] of repairedFindings.entries()) {
    console.log(`  ${String(i + 1).padStart(2, '0')}. ${f}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
