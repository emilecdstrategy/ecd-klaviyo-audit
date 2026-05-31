import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { KlaviyoSegmentSnapshot } from '../../lib/types';
import {
  buildSegmentSignalTags,
  parseSegmentDefinition,
  segmentPriorityScore,
} from '../../lib/segment-definition';
import { cn } from '../../lib/utils';

const VISIBLE_COUNT = 4;

function SignalTag({ label, tone }: { label: string; tone: 'good' | 'warn' | 'neutral' }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {label}
    </span>
  );
}

function tagTone(label: string): 'good' | 'warn' | 'neutral' {
  if (label.startsWith('Excludes Apple') || label.startsWith('Excludes bot') || label === 'Click-based engagement') {
    return 'good';
  }
  if (label.startsWith('Includes Apple') || label === 'Uses email opens') return 'warn';
  return 'neutral';
}

export default function ReportSegmentCriteria({ segments }: { segments: KlaviyoSegmentSnapshot[] }) {
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    return [...segments]
      .filter(s => !s.is_hidden)
      .map(segment => {
        const parsed = parseSegmentDefinition(segment);
        return {
          segment,
          parsed,
          name: segment.display_name || segment.name || 'Untitled segment',
          tags: buildSegmentSignalTags(parsed.signals),
        };
      })
      .sort((a, b) => {
        const priority = segmentPriorityScore(a.name) - segmentPriorityScore(b.name);
        if (priority !== 0) return priority;
        return a.name.localeCompare(b.name);
      });
  }, [segments]);

  const withDefinitions = rows.filter(r => r.parsed.available);
  const visible = expanded ? rows : rows.slice(0, VISIBLE_COUNT);
  const hasMore = rows.length > VISIBLE_COUNT;

  if (rows.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
            <Filter className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">How segments are built</h3>
            <p className="mt-0.5 text-sm text-gray-500">
              Criteria pulled from Klaviyo segment definitions — including Apple Privacy and bot-click filters where set.
              {withDefinitions.length < rows.length
                ? ` Showing rules for ${withDefinitions.length} of ${rows.length} segments (${rows.length - withDefinitions.length} need a re-sync for definition data).`
                : null}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {visible.map(({ segment, parsed, name, tags }) => (
          <div key={segment.id} className="px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{name}</p>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(tag => (
                    <SignalTag key={tag} label={tag} tone={tagTone(tag)} />
                  ))}
                </div>
              ) : null}
            </div>
            {parsed.available ? (
              <ul className="mt-2.5 space-y-1.5">
                {parsed.criteriaLines.map((line, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-400 italic">
                Segment definition not available for this audit snapshot. Re-run the Klaviyo sync to pull criteria.
              </p>
            )}
          </div>
        ))}
      </div>

      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 py-3 text-sm font-medium text-brand-primary hover:bg-gray-50"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Show fewer segments
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Show all {rows.length} segment definitions
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
