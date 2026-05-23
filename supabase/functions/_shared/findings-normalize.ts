/** Max lengths enforced in ai_analyze_audit JSON schema (keep in sync with src/lib/findings-normalize.ts). */
export const FINDINGS_MAX_LENGTH = 600;
export const CONCERNS_MAX_LENGTH = 500;

export function isFindingContinuation(prev: string, next: string): boolean {
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

export function mergeFindingContinuation(prev: string, next: string): string {
  const p = prev.trimEnd();
  const n = next.trimStart();
  if (/[a-zA-Z]$/.test(p) && /^[a-z]/.test(n)) return p + n;
  return `${p} ${n}`;
}

export function repairBrokenBoldMarkers(text: string): string {
  const count = (text.match(/\*\*/g) ?? []).length;
  if (count % 2 === 1) return `${text}**`;
  return text;
}

export function repairSplitFindings(items: string[]): string[] {
  const raw = items.map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];

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

export function resolveExecutiveFindings(findings?: string[], concerns?: string[]): string[] {
  const base =
    Array.isArray(findings) && findings.some((f) => f.trim())
      ? findings
      : Array.isArray(concerns)
        ? concerns
        : [];
  return repairSplitFindings(base).slice(0, 5);
}
