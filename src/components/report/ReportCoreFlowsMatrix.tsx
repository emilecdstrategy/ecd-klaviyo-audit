import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp, GitBranch } from 'lucide-react';
import { RichAuditText } from '../ui/RichAuditText';
import EntityTagChip from '../ui/EntityTagChip';
import ReportBlockHeader from './ReportBlockHeader';
import { cn } from '../../lib/utils';

export type CoreFlowRow = {
  flow_name?: string;
  present?: boolean;
  live?: boolean;
  email_count?: number | null;
  current_structure_note?: string;
  recommended_structure?: string;
};

function FlowStatusBadge({ present, live }: { present: boolean; live: boolean }) {
  if (!present) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
        Missing
      </span>
    );
  }
  if (!live) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
      Live
    </span>
  );
}

function FlowNote({ label, text }: { label: string; text: string }) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed || trimmed === 'N/A') return null;

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <RichAuditText text={trimmed} className="text-sm leading-relaxed text-gray-700" />
    </div>
  );
}

function FlowRowDetails({ row }: { row: CoreFlowRow }) {
  const current = String(row.current_structure_note ?? '').trim();
  const recommended = String(row.recommended_structure ?? '').trim();
  const hasCurrent = Boolean(current && current !== 'N/A');
  const hasRecommended = Boolean(recommended && recommended !== 'N/A');

  if (!hasCurrent && !hasRecommended) {
    return <p className="text-sm text-gray-400">No structure notes for this flow.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {hasCurrent && (
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <FlowNote label="Current structure" text={current} />
        </div>
      )}
      {hasRecommended && (
        <div className="rounded-lg border border-brand-primary/15 bg-brand-surface/40 px-4 py-3 shadow-sm">
          <FlowNote label="Recommended" text={recommended} />
        </div>
      )}
    </div>
  );
}

export default function ReportCoreFlowsMatrix({ rows }: { rows: CoreFlowRow[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!rows.length) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <ReportBlockHeader
        icon={
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
            <GitBranch className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
          </div>
        }
        title="Core Flows Matrix"
        subtitle="Quick status check — expand a row for structure notes."
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-5 py-3">Flow</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-center">Emails</th>
              <th className="px-5 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const hasNotes =
                Boolean(String(row.current_structure_note ?? '').trim()) ||
                Boolean(String(row.recommended_structure ?? '').trim());
              const isExpanded = expandedIndex === i;

              return (
                <Fragment key={i}>
                  <tr
                    className={cn(
                      'border-b border-gray-50 align-top transition-colors',
                      isExpanded && 'border-b-0 bg-brand-surface/30',
                    )}
                  >
                    <td className="px-5 py-3.5">
                      {row.flow_name ? (
                        <EntityTagChip type="flow" name={row.flow_name} />
                      ) : (
                        <span className="text-sm font-semibold text-gray-400">N/A</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <FlowStatusBadge present={Boolean(row.present)} live={Boolean(row.live)} />
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className="inline-flex min-w-[28px] items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                        {typeof row.email_count === 'number' ? row.email_count : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {hasNotes ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedIndex(isExpanded ? null : i)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                            isExpanded
                              ? 'bg-brand-primary/10 text-brand-primary-dark'
                              : 'text-brand-primary hover:bg-brand-surface hover:text-brand-primary-dark',
                          )}
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-gray-100 bg-brand-surface/20">
                      <td colSpan={4} className="px-5 pb-4 pt-1">
                        <div
                          className={cn(
                            'border-l-2 border-brand-primary/40 pl-4',
                            'animate-slide-up motion-reduce:animate-none',
                          )}
                        >
                          <FlowRowDetails row={row} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
