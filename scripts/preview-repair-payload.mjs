const headers = {
  apikey: 'sb_publishable_G2IHr1A1NUsk_Qr66xlIBA_Y4mI8gfs',
  Authorization: 'Bearer sb_publishable_G2IHr1A1NUsk_Qr66xlIBA_Y4mI8gfs',
};

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
    if (out.length === 0) out.push(item);
    else if (isFindingContinuation(out[out.length - 1], item)) {
      out[out.length - 1] = repairBrokenBoldMarkers(mergeFindingContinuation(out[out.length - 1], item));
    } else out.push(item);
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

const token = process.argv[2] ?? '52d12b492ea94f2a95f36fa8';
const url = `https://wuvqwuviwubthmuncuya.supabase.co/rest/v1/audits?public_share_token=eq.${token}&select=id,executive_summary`;
const rows = await fetch(url, { headers }).then((r) => r.json());
const audit = rows[0];
const payload = JSON.parse(audit.executive_summary);
payload.findings = resolveExecutiveFindings(payload.findings, payload.concerns);
payload.concerns = repairSplitFindings(payload.concerns ?? []);

console.log('audit id:', audit.id);
for (const [i, f] of payload.findings.entries()) {
  console.log(`${String(i + 1).padStart(2, '0')}. ${f}`);
}
