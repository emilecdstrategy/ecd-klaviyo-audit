import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useExpandableTableClip } from '../../hooks/useExpandableTableClip';
import { cn } from '../../lib/utils';
import type { KlaviyoCampaignSnapshot, KlaviyoSegmentSnapshot } from '../../lib/types';
import {
  buildSegmentSignalTags,
  parseSegmentDefinition,
} from '../../lib/segment-definition';
import { buildGroupNameMapFromSnapshots } from '../../lib/campaign-audiences';

const COLLAPSED_COUNT = 2;

export default function ReportSegmentTable({
  segments,
  campaigns = [],
  scrollable = false,
}: {
  segments: KlaviyoSegmentSnapshot[];
  campaigns?: KlaviyoCampaignSnapshot[];
  scrollable?: boolean;
}) {
  const groupNames = useMemo(
    () => buildGroupNameMapFromSnapshots(segments, campaigns),
    [segments, campaigns],
  );
  const rows = [...segments]
    .filter(s => !s.is_hidden)
    .sort((a, b) => {
      if (typeof a.display_order === 'number' && typeof b.display_order === 'number') {
        return a.display_order - b.display_order;
      }
      if (typeof a.display_order === 'number') return -1;
      if (typeof b.display_order === 'number') return 1;
      return ((a.display_name ?? a.name) || '').localeCompare((b.display_name ?? b.name) || '');
    });
  const [expanded, setExpanded] = useState(false);
  const needsExpand = !scrollable && rows.length > COLLAPSED_COUNT;
  const { wrapRef, maxHeight } = useExpandableTableClip(rows.length, expanded, COLLAPSED_COUNT);

  return (
    <div className="relative">
      <div
        ref={needsExpand ? wrapRef : undefined}
        className={cn(
          scrollable ? 'overflow-x-auto' : '-mx-6 overflow-x-auto overflow-y-hidden px-6',
          needsExpand && 'transition-[max-height] duration-300 ease-out motion-reduce:transition-none',
        )}
        style={needsExpand ? { maxHeight } : undefined}
      >
        <table className="w-full min-w-[960px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Segment</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Criteria</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const parsed = parseSegmentDefinition(s, undefined, groupNames);
              const tags = buildSegmentSignalTags(parsed.signals);
              return (
              <tr key={s.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-4 py-3 align-top">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {s.display_name || s.name || '—'}
                    </p>
                    {s.display_notes ? (
                      <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{s.display_notes}</p>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 align-top max-w-md">
                  {parsed.available ? (
                    <div className="space-y-1.5">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {tags.slice(0, 3).map(tag => (
                            <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                        {parsed.criteriaLines.join(' · ')}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Not synced</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-xs text-gray-600">
                  {s.created_at_klaviyo ? new Date(s.created_at_klaviyo).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 align-top text-xs text-gray-600">
                  {s.updated_at_klaviyo ? new Date(s.updated_at_klaviyo).toLocaleDateString() : '—'}
                </td>
              </tr>
            );})}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  No segments found in Klaviyo for this audit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {needsExpand && !expanded && (
        <>
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#fafafa] via-[#fafafa]/95 to-transparent pointer-events-none" />
          <div className="absolute bottom-6 left-0 right-0 z-10 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:text-brand-primary-dark transition-colors duration-200 pointer-events-auto"
            >
              Show all {rows.length} segments <ChevronDown className="w-4 h-4 transition-transform duration-300" />
            </button>
          </div>
        </>
      )}

      {needsExpand && expanded && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:text-brand-primary-dark transition-colors duration-200"
          >
            Collapse <ChevronUp className="w-4 h-4 transition-transform duration-300" />
          </button>
        </div>
      )}
    </div>
  );
}
