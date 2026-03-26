import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { KlaviyoFormSnapshot } from '../../lib/types';

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-gray-50 text-gray-600 border-gray-200';
  if (s === 'live' || s === 'published') cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  else if (s === 'draft') cls = 'bg-red-50 text-red-600 border-red-200';

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {status || '—'}
    </span>
  );
}

const COLLAPSED_COUNT = 10;

export default function ReportFormTable({ forms }: { forms: KlaviyoFormSnapshot[] }) {
  const rows = [...forms].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const [expanded, setExpanded] = useState(false);
  const needsExpand = rows.length > COLLAPSED_COUNT;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <div className="relative">
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full min-w-[820px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Form</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f, i) => (
              <tr key={f.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <td className="px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{f.name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{f.form_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={f.status || '—'} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {f.updated_at_klaviyo ? new Date(f.updated_at_klaviyo).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                  No signup forms found in Klaviyo for this audit.
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
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-primary hover:text-brand-primary/80 transition-colors py-2 px-4"
          >
            {expanded ? (
              <>Collapse <ChevronUp className="w-4 h-4" /></>
            ) : (
              <>Show all {rows.length} forms <ChevronDown className="w-4 h-4" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
