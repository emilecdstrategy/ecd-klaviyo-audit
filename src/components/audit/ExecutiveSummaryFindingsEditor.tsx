import { useEffect, useMemo, useRef } from 'react';
import type { Audit } from '../../lib/types';
import { updateAudit } from '../../lib/db';
import { repairSplitFindings } from '../../lib/findings-normalize';
import SimpleRichEditor from '../ui/SimpleRichEditor';

type ExecPayload = {
  text?: string;
  findings?: string[];
  strengths?: string[];
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

function normalizeFindings(findings: string[] | undefined): string[] {
  const list = Array.isArray(findings) ? findings : [];
  const padded = [...list];
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
  const autoRepaired = useRef(false);

  const payload = useMemo(
    () => parseExecutiveSummary(audit.executive_summary || ''),
    [audit.executive_summary],
  );

  const findings = useMemo(
    () => normalizeFindings(payload.findings),
    [payload.findings],
  );

  const persistPayload = (nextPayload: ExecPayload) => {
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

  useEffect(() => {
    if (autoRepaired.current) return;
    const repairedFindings = repairSplitFindings(payload.findings ?? []);
    const needsRepair =
      JSON.stringify(payload.findings ?? []) !== JSON.stringify(repairedFindings);
    if (!needsRepair) return;
    autoRepaired.current = true;
    persistPayload({
      ...payload,
      findings: repairedFindings,
    });
  }, [audit.executive_summary, audit.id, payload]);

  const scheduleSave = (nextFindings: string[]) => {
    persistPayload({
      ...payload,
      findings: nextFindings,
    });
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
              value={finding}
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
