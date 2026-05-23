import { useMemo, useRef } from 'react';
import type { Audit } from '../../lib/types';
import { updateAudit } from '../../lib/db';
import SimpleRichEditor from '../ui/SimpleRichEditor';

type ExecPayload = {
  text?: string;
  findings?: string[];
  strengths?: string[];
  concerns?: string[];
  timeline?: unknown[];
};

function parseExecutiveSummary(raw: string): ExecPayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ExecPayload;
    }
  } catch {
    /* plain text */
  }
  return { text: raw };
}

function normalizeFindings(findings: string[] | undefined, concerns: string[] | undefined): string[] {
  const base = Array.isArray(findings) && findings.length > 0
    ? findings
    : (Array.isArray(concerns) ? concerns.slice(0, 5) : []);
  const padded = [...base];
  while (padded.length < 5) padded.push('');
  return padded.slice(0, 5);
}

export default function ExecutiveSummaryFindingsEditor({
  audit,
  onAuditChange,
}: {
  audit: Audit;
  onAuditChange: (next: Audit) => void;
}) {
  const saveTimer = useRef<number | null>(null);

  const payload = useMemo(
    () => parseExecutiveSummary(audit.executive_summary || ''),
    [audit.executive_summary],
  );

  const findings = useMemo(
    () => normalizeFindings(payload.findings, payload.concerns),
    [payload.findings, payload.concerns],
  );

  const scheduleSave = (nextFindings: string[]) => {
    const nextPayload = {
      ...payload,
      findings: nextFindings,
    };
    const serialized = JSON.stringify(nextPayload);
    onAuditChange({ ...audit, executive_summary: serialized });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await updateAudit(audit.id, { executive_summary: serialized });
      } catch {
        /* silent */
      }
    }, 500) as unknown as number;
  };

  const updateFinding = (index: number, value: string) => {
    const next = [...findings];
    next[index] = value;
    scheduleSave(next);
  };

  return (
    <div className="bg-white rounded-xl p-6 card-shadow">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Key Findings</h3>
      <p className="text-xs text-gray-500 mb-4">
        Five numbered problem statements shown first on the public report. No revenue figures.
      </p>
      <div className="space-y-4">
        {findings.map((finding, index) => (
          <div key={index}>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Finding {String(index + 1).padStart(2, '0')}
            </label>
            <SimpleRichEditor
              value={finding.replace(/\*\*(.+?)\*\*/g, '$1')}
              onChange={val => updateFinding(index, val)}
              rows={2}
              placeholder="Describe a specific problem or gap in this account…"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
