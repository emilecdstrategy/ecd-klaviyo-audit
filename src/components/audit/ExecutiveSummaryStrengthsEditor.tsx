import { useMemo, useRef } from 'react';
import type { Audit } from '../../lib/types';
import { updateAudit } from '../../lib/db';
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

function normalizeStrengths(strengths: string[] | undefined): string[] {
  const list = Array.isArray(strengths) ? strengths.filter(Boolean) : [];
  const padded = [...list];
  while (padded.length < 3) padded.push('');
  return padded.slice(0, 7);
}

export default function ExecutiveSummaryStrengthsEditor({
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

  const strengths = useMemo(
    () => normalizeStrengths(payload.strengths),
    [payload.strengths],
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

  const updateStrength = (index: number, value: string) => {
    const next = [...strengths];
    next[index] = value;
    persistPayload({
      ...payload,
      strengths: next.filter((s, i) => s.trim().length > 0 || i < 3),
    });
  };

  return (
    <div className="bg-white rounded-xl p-6 card-shadow">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">What&apos;s Working</h3>
      <p className="text-xs text-gray-500 mb-4">
        Strengths shown below the key findings on the public report.
      </p>
      <div className="space-y-4">
        {strengths.map((strength, index) => (
          <div key={index}>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Strength {index + 1}
              {index >= 3 && <span className="text-gray-400 font-normal"> (optional)</span>}
            </label>
            <SimpleRichEditor
              value={strength}
              onChange={val => updateStrength(index, val)}
              rows={2}
              placeholder="Describe something the account is doing well…"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
