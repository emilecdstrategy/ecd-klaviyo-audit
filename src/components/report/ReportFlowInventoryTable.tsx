import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { KlaviyoFlowSnapshot } from '../../lib/types';

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-gray-50 text-gray-600 border-gray-200';
  if (s.includes('live') || s === 'manual') cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  else if (s.includes('draft')) cls = 'bg-red-50 text-red-600 border-red-200';
  else if (s.includes('paused')) cls = 'bg-amber-50 text-amber-600 border-amber-200';

  let label = status || '—';
  if (s.includes('draft')) label = 'Draft';
  else if (s.includes('paused')) label = 'Paused';
  else if (s.includes('live')) label = 'Live';
  else if (s === 'manual') label = 'Manual';

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

const COLLAPSED_COUNT = 10;

export default function ReportFlowInventoryTable({ flows }: { flows: KlaviyoFlowSnapshot[] }) {
  const rows = [...flows].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const [expanded, setExpanded] = useState(false);
  const needsExpand = rows.length > COLLAPSED_COUNT;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <div className="relative">
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full min-w-[840px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Flow</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Trigger</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f, i) => (
              <tr key={f.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{f.name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{f.flow_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={f.status} />
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">{f.trigger_type || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">
                    {f.updated_at_klaviyo ? new Date(f.updated_at_klaviyo).toLocaleDateString() : '—'}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  No flows found in Klaviyo for this audit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {needsExpand && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none" />
      )}

      {needsExpand && (
        <div className="relative z-10 flex justify-center pt-3 pb-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:text-brand-primary-dark transition-colors"
          >
            {expanded ? (
              <>Collapse <ChevronUp className="w-4 h-4" /></>
            ) : (
              <>Show all {rows.length} flows <ChevronDown className="w-4 h-4" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
