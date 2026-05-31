/**
 * One-off: regenerate top-level executive summary (benchmark-aware) + refine with client context.
 * Usage: node scripts/refresh-audit-executive.mjs <audit_id>
 */
const auditId = process.argv[2];
if (!auditId) {
  console.error('Usage: node scripts/refresh-audit-executive.mjs <audit_id>');
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

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function invokeAi(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai_analyze_audit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data?.ok) {
    throw new Error(data?.error?.message ?? `AI failed (${res.status})`);
  }
  return data;
}

async function main() {
  const auditRows = await rest(`/rest/v1/audits?id=eq.${auditId}&select=id,client_id,list_size,aov,monthly_traffic,context,executive_summary`);
  const audit = auditRows[0];
  if (!audit) throw new Error('Audit not found');

  const clientRows = await rest(`/rest/v1/clients?id=eq.${audit.client_id}&select=id,name,company_name,industry,esp_platform,website_url,notes`);
  const client = clientRows[0];
  if (!client) throw new Error('Client not found');

  let preserved = {};
  try {
    const parsed = typeof audit.executive_summary === 'string' ? JSON.parse(audit.executive_summary) : audit.executive_summary;
    if (parsed && typeof parsed === 'object') {
      preserved = {
        findingsHidden: parsed.findingsHidden,
        strengthsHidden: parsed.strengthsHidden,
      };
    }
  } catch { /* plain text legacy */ }

  const sectionRows = await rest(`/rest/v1/audit_sections?audit_id=eq.${auditId}&select=section_key,summary_text,ai_findings,human_edited_findings,revenue_opportunity,confidence,current_state_notes,optimized_notes`);
  const baselineSections = (sectionRows ?? []).map((s) => ({ section_key: s.section_key }));

  const wizard = {
    auditId,
    clientId: client.id,
    clientName: client.name,
    companyName: client.company_name,
    industry: client.industry,
    espPlatform: client.esp_platform || 'Klaviyo',
    websiteUrl: client.website_url || '',
    listSize: Math.round(Number(audit.list_size) || 0),
    aov: Math.round(Number(audit.aov) || 0),
    monthlyTraffic: Math.round(Number(audit.monthly_traffic) || 0),
    notes: client.notes || '',
    auditMethod: 'api',
    auditContext: audit.context ?? undefined,
    profileAudienceScan: 'full',
    clientSellsSubscriptions: Boolean(audit.context?.sells_subscriptions),
  };

  console.log('Running top-level AI analysis (benchmark-aware)…');
  const top = await invokeAi({ ...wizard, requestedSectionKeys: [], aiMode: 'top_level_only' });

  let executiveSummary = top.executiveSummary;
  let findings = top.findings ?? [];
  let strengths = top.strengths ?? [];
  let timeline = top.implementationTimeline ?? [];

  const hasContext = Boolean(
    String(audit.context?.meeting_notes ?? '').trim() ||
      String(audit.context?.client_background ?? '').trim() ||
      String(audit.context?.custom_instructions ?? '').trim(),
  );

  if (hasContext) {
    console.log('Refining with client context…');
    try {
      const refined = await invokeAi({
        ...wizard,
        aiMode: 'refine',
        refineBaseline: {
          companyName: wizard.companyName,
          clientName: wizard.clientName,
          executiveSummary,
          findings,
          strengths,
          implementationTimeline: timeline,
          sections: baselineSections,
        },
        auditContext: audit.context,
      });
      executiveSummary = refined.executiveSummary ?? executiveSummary;
      findings = refined.findings ?? findings;
      strengths = refined.strengths ?? strengths;
      timeline = refined.implementationTimeline ?? timeline;
    } catch (err) {
      console.warn('Refine step failed; saving benchmark-aware top-level output only.', err instanceof Error ? err.message : err);
    }
  }

  const payload = {
    text: executiveSummary ?? '',
    findings,
    strengths,
    timeline,
    ...preserved,
  };

  await rest(`/rest/v1/audits?id=eq.${auditId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      executive_summary: JSON.stringify(payload),
      updated_at: new Date().toISOString(),
    }),
  });

  console.log('Updated executive_summary for audit', auditId);
  console.log('Findings sample:', findings[0]?.slice(0, 120) ?? '(none)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
