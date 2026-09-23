#!/usr/bin/env node
/**
 * Backfill audit_sections.key_findings from legacy summary_text / human_edited_findings.
 * Usage:
 *   node scripts/backfill-section-key-findings.mjs
 *   node scripts/backfill-section-key-findings.mjs <audit_id>
 *   node scripts/backfill-section-key-findings.mjs --client "Grill Rescue"
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let auditIdArg = null;
let clientNameArg = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--client') clientNameArg = args[++i];
  else if (!args[i].startsWith('-')) auditIdArg = args[i];
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://wuvqwuviwubthmuncuya.supabase.co';
const PROJECT_REF = 'wuvqwuviwubthmuncuya';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const ps = resolve(root, 'scripts/read-supabase-cli-token.ps1');
    const out = execSync(`powershell -NoProfile -File "${ps}"`, { encoding: 'utf8' }).trim();
    const line = out.split(/\r?\n/).filter(Boolean).pop() ?? '';
    if (line.startsWith('sbp_')) return line;
  } catch {
    /* ignore */
  }
  return null;
}

async function mgmtSql(query) {
  const token = getAccessToken();
  if (!token) throw new Error('Missing Supabase access token (run supabase login)');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`Mgmt SQL ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function rest(path, opts = {}) {
  if (!SERVICE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function splitProseToBullets(prose) {
  const text = String(prose ?? '').trim();
  if (!text) return [];
  const bySentence = text
    .split(/(?<=[.!?])\s+(?=[A-Z*])/)
    .map(s => s.trim())
    .filter(Boolean);
  if (bySentence.length >= 2) return bySentence.slice(0, 5);
  return [text];
}

function buildKeyFindings(section) {
  const existing = section.key_findings;
  if (existing?.items?.some(item => String(item).trim())) {
    return {
      items: existing.items.map(item => String(item)),
      items_hidden: Array.isArray(existing.items_hidden) ? existing.items_hidden : existing.items.map(() => false),
    };
  }
  const legacy = String(section.human_edited_findings ?? '').trim()
    || String(section.summary_text ?? '').trim();
  const items = splitProseToBullets(legacy);
  return { items, items_hidden: items.map(() => false) };
}

async function resolveAuditIds() {
  if (auditIdArg) return [auditIdArg];
  if (clientNameArg) {
    const rows = SERVICE_KEY
      ? await rest(`/rest/v1/audits?select=id,clients!inner(name,company_name)&or=(clients.name.ilike.*${encodeURIComponent(clientNameArg)}*,clients.company_name.ilike.*${encodeURIComponent(clientNameArg)}*)`)
      : await mgmtSql(`
          SELECT a.id
          FROM audits a
          JOIN clients c ON c.id = a.client_id
          WHERE c.name ILIKE '%${clientNameArg.replace(/'/g, "''")}%'
             OR c.company_name ILIKE '%${clientNameArg.replace(/'/g, "''")}%'
          ORDER BY a.created_at DESC;
        `);
    const ids = (rows ?? []).map(r => r.id);
    if (!ids.length) throw new Error(`No audit found for client "${clientNameArg}"`);
    return ids;
  }
  throw new Error('Provide audit_id or --client "Name"');
}

async function fetchSections(auditId) {
  if (SERVICE_KEY) {
    return rest(`/rest/v1/audit_sections?audit_id=eq.${auditId}&select=id,section_key,summary_text,human_edited_findings,key_findings`);
  }
  return mgmtSql(`
    SELECT id, section_key, summary_text, human_edited_findings, key_findings
    FROM audit_sections
    WHERE audit_id = '${auditId}'::uuid;
  `);
}

async function updateSection(id, keyFindings) {
  const payload = JSON.stringify({ key_findings: keyFindings }).replace(/'/g, "''");
  if (SERVICE_KEY) {
    await rest(`/rest/v1/audit_sections?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ key_findings: keyFindings }),
      headers: { Prefer: 'return=minimal' },
    });
    return;
  }
  await mgmtSql(`
    UPDATE audit_sections
    SET key_findings = '${payload}'::jsonb
    WHERE id = '${id}'::uuid;
  `);
}

async function main() {
  const auditIds = await resolveAuditIds();
  console.log(`Backfilling section key_findings for ${auditIds.length} audit(s)...`);

  let updated = 0;
  for (const auditId of auditIds) {
    const sections = await fetchSections(auditId);
    for (const section of sections ?? []) {
      const next = buildKeyFindings(section);
      if (!next.items.some(item => item.trim())) {
        console.log(`  skip ${section.section_key} (no legacy prose)`);
        continue;
      }
      await updateSection(section.id, next);
      updated += 1;
      console.log(`  updated ${section.section_key} (${next.items.length} bullet(s)) for audit ${auditId}`);
    }
  }

  console.log(`Done. Updated ${updated} section(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
