import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AuditSection } from '../../../lib/types';
import { parseWebRoadmapDetail, type WebRoadmapRow } from '../../../lib/web-report-details';
import {
  HOUR_STEP,
  MAX_HOURS,
  formatHours,
  normalizeHours,
  setupCost,
} from '../../../lib/web-audit-pricing';
import { formatCurrency } from '../../../lib/revenue-calculator';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import BrandedCheckbox from '../../ui/BrandedCheckbox';
import HoverTooltip from '../../ui/HoverTooltip';

const PRIORITY_STYLES: Record<WebRoadmapRow['priority'], string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};
const PRIORITY_ORDER: Record<WebRoadmapRow['priority'], number> = { high: 0, medium: 1, low: 2 };

export default function WebRoadmapTable({
  section,
  title,
  hideTitle = false,
}: {
  section: AuditSection;
  title: string;
  /** The report frame already renders a numbered section heading. */
  hideTitle?: boolean;
}) {
  const { editMode, updateSectionField, updateSectionDetailValue } = useReportEdit();
  const detail = useMemo(() => parseWebRoadmapDetail(section.section_details), [section.section_details]);
  const rows = detail.rows;
  const hourlyRate = detail.hourly_rate ?? 0;

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
      {
        priority: 'medium',
        item_name: 'New item',
        template_slug: null,
        note: '',
        setup_hours: 1,
        setup_cost_label: 'Custom / TBD',
        ongoing_cost_label: '—',
        hidden: false,
        investment_included: true,
      },
    ]);

  /** What the client reads in the Setup Cost column. Hours drive the figure but
   *  never appear; a row nobody has estimated falls back to whatever the
   *  pre-hours audits wrote there. */
  const setupDisplay = (row: WebRoadmapRow): string => {
    const cost = hourlyRate > 0 ? setupCost(row, hourlyRate) : null;
    return cost == null ? (row.setup_cost_label || 'Custom / TBD') : formatCurrency(cost);
  };

  return (
    <section className="rounded-2xl bg-white p-6 card-shadow sm:p-7">
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
      {(editMode || section.summary_text) && (
        <div className="mt-1.5 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="Roadmap intro…"
          />
        </div>
      )}

      {editMode && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-surface/60 px-3 py-2 text-xs text-gray-600">
          <HoverTooltip
            label="Hourly rate"
            description="Setup cost is hours times this rate. It is stamped onto this audit when the roadmap is generated, so changing the platform default later never reprices a report a client has already read. Edit it here to override it for this audit only."
          >
            <span className="font-semibold uppercase tracking-wider text-gray-500">Rate</span>
          </HoverTooltip>
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min={1}
            step={5}
            value={hourlyRate || ''}
            placeholder="175"
            onChange={(e) => {
              const n = Number(e.target.value);
              updateSectionDetailValue(
                section.section_key,
                ['web_roadmap', 'hourly_rate'],
                Number.isFinite(n) && n > 0 ? Math.round(n) : null,
              );
            }}
            className="w-20 rounded border border-gray-200 px-2 py-1 text-xs tabular-nums"
          />
          <span className="text-gray-400">per hour, this audit only</span>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              {editMode && (
                <th className="py-2 pr-3">
                  <HoverTooltip
                    label="In the investment summary"
                    description="Ticked rows are added up in the investment summary below and carried into a proposal built from this audit. Untick to leave an item on the roadmap without pricing it in."
                  >
                    <span>In</span>
                  </HoverTooltip>
                </th>
              )}
              <th className="py-2 pr-3">Priority</th>
              <th className="py-2 pr-3">Item</th>
              {editMode && <th className="py-2 pr-3">Hours</th>}
              <th className="py-2 pr-3">Setup Cost</th>
              <th className="py-2 pr-3">Ongoing</th>
              {editMode && <th className="py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.map(({ r, i }) => {
              const excluded = r.investment_included === false;
              return (
                <tr key={i} className={r.hidden || excluded ? 'opacity-50' : ''}>
                  {editMode && (
                    <td className="py-2.5 pr-3 align-top">
                      <BrandedCheckbox
                        checked={!excluded}
                        onChange={(checked) => setRow(i, { investment_included: checked })}
                        aria-label={`Include ${r.item_name} in the investment summary`}
                      />
                    </td>
                  )}
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
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${PRIORITY_STYLES[r.priority]}`}>
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
                  {editMode && (
                    <td className="py-2.5 pr-3 align-top">
                      <input
                        type="number"
                        min={HOUR_STEP}
                        max={MAX_HOURS}
                        step={HOUR_STEP}
                        value={r.setup_hours ?? ''}
                        placeholder="—"
                        onChange={(e) => setRow(i, { setup_hours: normalizeHours(e.target.value) })}
                        className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-xs tabular-nums"
                        aria-label={`Setup hours for ${r.item_name}`}
                      />
                    </td>
                  )}
                  <td className="py-2.5 pr-3 align-top font-medium tabular-nums text-gray-900">
                    {setupDisplay(r)}
                    {editMode && r.setup_hours != null && (
                      <span className="ml-1.5 text-xs font-normal text-gray-400">{formatHours(r.setup_hours)}</span>
                    )}
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
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={editMode ? 7 : 4} className="py-4 text-center text-sm text-gray-400">
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
