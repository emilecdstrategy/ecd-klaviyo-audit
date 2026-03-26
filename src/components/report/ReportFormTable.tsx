import type { KlaviyoFormSnapshot } from '../../lib/types';

function Badge({ children }: { children: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-100">
      {children}
    </span>
  );
}

export default function ReportFormTable({ forms }: { forms: KlaviyoFormSnapshot[] }) {
  const rows = [...forms].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
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
          {rows.map((f, i) => (
            <tr key={f.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
              <td className="px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{f.name || '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{f.form_id}</p>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge>{f.status || '—'}</Badge>
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
  );
}

