import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AuditSection } from '../../../lib/types';
import { parseWebRoadmap, type WebRoadmapRow } from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';

const PRIORITY_STYLES: Record<WebRoadmapRow['priority'], string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};
const PRIORITY_ORDER: Record<WebRoadmapRow['priority'], number> = { high: 0, medium: 1, low: 2 };

export default function WebRoadmapTable({ section, title }: { section: AuditSection; title: string }) {
  const { editMode, updateSectionField, updateSectionDetailValue } = useReportEdit();
  const rows = useMemo(() => parseWebRoadmap(section.section_details), [section.section_details]);

  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => editMode || !r.hidden)
    .sort((a, b) => PRIORITY_ORDER[a.r.priority] - PRIORITY_ORDER[b.r.priority]);

  const writeRows = (next: WebRoadmapRow[]) => updateSectionDetailValue(section.section_key, ['web_roadmap', 'rows'], next);
  const setRow = (i: number, patch: Partial<WebRoadmapRow>) => writeRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => writeRows(rows.filter((_, idx) => idx !== i));
  const addRow = () =>
    writeRows([
      ...rows,
      { priority: 'medium', item_name: 'New item', template_slug: null, note: '', setup_cost_label: 'Custom / TBD', ongoing_cost_label: '—', hidden: false },
    ]);

  return (
    <section className="rounded-xl bg-white p-6 card-shadow">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {(editMode || section.summary_text) && (
        <div className="mt-1.5 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="Roadmap intro…"
          />
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Priority</th>
              <th className="py-2 pr-3">Item</th>
              <th className="py-2 pr-3">Setup Cost</th>
              <th className="py-2 pr-3">Ongoing</th>
              {editMode && <th className="py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.map(({ r, i }) => (
              <tr key={i} className={r.hidden ? 'opacity-50' : ''}>
                <td className="py-2.5 pr-3 align-top">
                  {editMode ? (
                    <select
                      value={r.priority}
                      onChange={(e) => setRow(i, { priority: e.target.value as WebRoadmapRow['priority'] })}
                      className="rounded border border-gray-200 px-1.5 py-0.5 text-xs"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  ) : (
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${PRIORITY_STYLES[r.priority]}`}>
                      {r.priority}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <div className="font-medium text-gray-900">
                    <EditablePlainText value={r.item_name} onSave={(v) => setRow(i, { item_name: v })} />
                  </div>
                  {(editMode || r.note) && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      <EditablePlainText value={r.note} onSave={(v) => setRow(i, { note: v })} placeholder="Note…" />
                    </div>
                  )}
                </td>
                <td className="py-2.5 pr-3 align-top font-medium text-gray-900">
                  <EditablePlainText value={r.setup_cost_label} onSave={(v) => setRow(i, { setup_cost_label: v })} />
                </td>
                <td className="py-2.5 pr-3 align-top text-gray-700">
                  <EditablePlainText value={r.ongoing_cost_label} onSave={(v) => setRow(i, { ongoing_cost_label: v })} />
                </td>
                {editMode && (
                  <td className="py-2.5 align-top">
                    <button type="button" onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500" aria-label="Remove row">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={editMode ? 5 : 4} className="py-4 text-center text-sm text-gray-400">
                  No roadmap items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editMode && (
        <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline">
          <Plus className="h-3 w-3" /> Add roadmap item
        </button>
      )}
    </section>
  );
}
