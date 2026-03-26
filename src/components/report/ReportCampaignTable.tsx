import type { KlaviyoCampaignSnapshot } from '../../lib/types';

function Badge({ children }: { children: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-100">
      {children}
    </span>
  );
}

export default function ReportCampaignTable({ campaigns }: { campaigns: KlaviyoCampaignSnapshot[] }) {
  const rows = [...campaigns].sort((a, b) => (b.updated_at_klaviyo || '').localeCompare(a.updated_at_klaviyo || ''));

  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full min-w-[860px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Campaign</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Channel</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
              <td className="px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.name || '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{c.campaign_id}</p>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge>{c.status || '—'}</Badge>
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {c.send_channel || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">
                {c.updated_at_klaviyo ? new Date(c.updated_at_klaviyo).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                No campaigns found in Klaviyo for this audit.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

