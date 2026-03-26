import type { KlaviyoSegmentSnapshot } from '../../lib/types';

export default function ReportSegmentTable({ segments }: { segments: KlaviyoSegmentSnapshot[] }) {
  const rows = [...segments].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full min-w-[760px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Segment</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
              <td className="px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{s.name || '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{s.segment_id}</p>
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {s.created_at_klaviyo ? new Date(s.created_at_klaviyo).toLocaleDateString() : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {s.updated_at_klaviyo ? new Date(s.updated_at_klaviyo).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                No segments found in Klaviyo for this audit.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

