import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  listCampaignSnapshots,
  listFormSnapshots,
  listSegmentSnapshots,
  updateCampaignSnapshotRow,
  updateFormSnapshotRow,
  updateSegmentSnapshotRow,
} from '../../lib/db';
import { useToast } from '../ui/Toast';

type Kind = 'segment' | 'form' | 'campaign';

interface Props {
  auditId: string;
  kind: Kind;
}

interface Row {
  id: string;
  name: string;
  externalId: string;
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
  meta?: string;
}

type RowPatch = {
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
};

const LABELS: Record<Kind, { singular: string; plural: string; notes: string; external: string }> = {
  segment: {
    singular: 'segment',
    plural: 'segments',
    notes: 'Optional editorial note (rendered beneath the segment name).',
    external: 'Segment ID',
  },
  form: {
    singular: 'signup form',
    plural: 'signup forms',
    notes: 'Optional editorial note (rendered beneath the form name).',
    external: 'Form ID',
  },
  campaign: {
    singular: 'campaign',
    plural: 'campaigns',
    notes: 'Optional editorial note (rendered beneath the campaign name).',
    external: 'Campaign ID',
  },
};

export default function SnapshotRowsEditor({ auditId, kind }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const labels = LABELS[kind];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list: Row[] = [];
        if (kind === 'segment') {
          const data = await listSegmentSnapshots(auditId);
          list = data.map(s => ({
            id: s.id,
            name: s.name || '—',
            externalId: s.segment_id,
            is_hidden: s.is_hidden,
            display_name: s.display_name,
            display_notes: s.display_notes,
            display_order: s.display_order,
            meta: s.created_at_klaviyo ? new Date(s.created_at_klaviyo).toLocaleDateString() : '',
          }));
        } else if (kind === 'form') {
          const data = await listFormSnapshots(auditId);
          list = data.map(f => ({
            id: f.id,
            name: f.name || '—',
            externalId: f.form_id,
            is_hidden: f.is_hidden,
            display_name: f.display_name,
            display_notes: f.display_notes,
            display_order: f.display_order,
            meta: f.status,
          }));
        } else {
          const data = await listCampaignSnapshots(auditId);
          list = data.map(c => ({
            id: c.id,
            name: c.name || '—',
            externalId: c.campaign_id,
            is_hidden: c.is_hidden,
            display_name: c.display_name,
            display_notes: c.display_notes,
            display_order: c.display_order,
            meta: [c.status, c.send_channel].filter(Boolean).join(' · '),
          }));
        }
        list.sort((a, b) => {
          if (typeof a.display_order === 'number' && typeof b.display_order === 'number') {
            return a.display_order - b.display_order;
          }
          return (a.name || '').localeCompare(b.name || '');
        });
        if (!cancelled) setRows(list);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : `Failed to load ${labels.plural}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auditId, kind, labels.plural]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (rows === null) return <p className="text-xs text-gray-500">Loading {labels.plural}…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">
        No {labels.plural} captured for this audit.
      </p>
    );
  }

  const persist = async (id: string, p: RowPatch) => {
    if (kind === 'segment') await updateSegmentSnapshotRow(id, p);
    else if (kind === 'form') await updateFormSnapshotRow(id, p);
    else await updateCampaignSnapshotRow(id, p);
  };

  const patch = async (id: string, p: RowPatch) => {
    setRows(prev => prev?.map(r => (r.id === id ? { ...r, ...p } : r)) ?? prev);
    try {
      await persist(id, p);
      toast(`${labels.singular[0].toUpperCase()}${labels.singular.slice(1)} updated`);
    } catch (e) {
      toast(e instanceof Error ? e.message : `Failed to update ${labels.singular}`);
    }
  };

  return (
    <div className="bg-white rounded-xl card-shadow overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {labels.singular[0].toUpperCase()}
            {labels.singular.slice(1)} rows
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Hide rows or override their display name / editorial note on the public report. Underlying Klaviyo data stays intact.
          </p>
        </div>
        <span className="text-[11px] text-gray-400">{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide w-16">Show</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{labels.singular}</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Display name</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide min-w-[240px]">
                Editorial note
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide w-24">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(r => {
              const hidden = Boolean(r.is_hidden);
              return (
                <tr key={r.id} className={hidden ? 'bg-amber-50/40' : ''}>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => patch(r.id, { is_hidden: !hidden })}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                        hidden
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                      title={hidden ? 'Row is hidden in public report' : 'Row is visible'}
                    >
                      {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {hidden ? 'Hidden' : 'Visible'}
                    </button>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-sm font-medium text-gray-800">{r.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {r.meta ? `${r.meta} · ` : ''}
                      {r.externalId}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="text"
                      value={r.display_name ?? r.name}
                      placeholder={r.name}
                      onChange={e => patch(r.id, { display_name: e.target.value || null })}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <textarea
                      rows={2}
                      value={r.display_notes ?? ''}
                      placeholder={labels.notes}
                      onChange={e => patch(r.id, { display_notes: e.target.value || null })}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="number"
                      value={typeof r.display_order === 'number' ? r.display_order : ''}
                      placeholder="—"
                      onChange={e => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        patch(r.id, { display_order: Number.isFinite(v as number) ? (v as number) : null });
                      }}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
