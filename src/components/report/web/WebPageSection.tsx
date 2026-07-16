import { useMemo, useState } from 'react';
import { Monitor, Plus, Smartphone, Trash2, X } from 'lucide-react';
import type { AuditSection, WebPageSnapshot } from '../../../lib/types';
import { parseWebSectionDetail } from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import ReportSectionKeyFindings from '../ReportSectionKeyFindings';
import ImageLightbox from '../../ui/ImageLightbox';
import WebHighlightLayer from './WebHighlightLayer';
import WebCropCard from './WebCropCard';

export default function WebPageSection({
  section,
  title,
  snapshots,
}: {
  section: AuditSection;
  title: string;
  snapshots: WebPageSnapshot[];
}) {
  const { editMode, updateSectionField, updateSectionDetailValue } = useReportEdit();
  const detail = useMemo(() => parseWebSectionDetail(section.section_details), [section.section_details]);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [lightbox, setLightbox] = useState<string | null>(null);

  const successful = snapshots.filter((s) => s.status === 'success' && s.screenshot_url);
  const byId = new Map(successful.map((s) => [s.id, s]));

  // The big screenshot shown for the selected viewport (prefer full-page).
  const shown =
    successful.find((s) => s.viewport === viewport && s.variant === 'full') ??
    successful.find((s) => s.viewport === viewport) ??
    byId.get(detail.primary_snapshot_id ?? '') ??
    successful[0] ??
    null;

  const hasDesktop = successful.some((s) => s.viewport === 'desktop');
  const hasMobile = successful.some((s) => s.viewport === 'mobile');

  const visibleFindings = detail.findings
    .map((f, i) => ({ f, number: i + 1 }))
    .filter(({ f }) => editMode || !f.hidden);

  const markers = visibleFindings
    .filter(({ f }) => f.highlight && shown && f.highlight.snapshot_id === shown.id && !f.hidden)
    .map(({ f, number }) => ({ index: number, highlight: f.highlight! }));

  const setFinding = (i: number, key: string, value: unknown) => {
    const next = detail.findings.map((f, idx) => (idx === i ? { ...f, [key]: value } : f));
    updateSectionDetailValue(section.section_key, ['web', 'findings'], next);
  };
  const removeFindingHighlight = (i: number) => {
    const next = detail.findings.map((f, idx) => (idx === i ? { ...f, highlight: null } : f));
    updateSectionDetailValue(section.section_key, ['web', 'findings'], next);
  };
  const removeFinding = (i: number) => {
    const next = detail.findings.filter((_, idx) => idx !== i);
    updateSectionDetailValue(section.section_key, ['web', 'findings'], next);
  };
  const setPro = (i: number, value: string) => {
    const next = detail.pros.map((p, idx) => (idx === i ? value : p));
    updateSectionDetailValue(section.section_key, ['web', 'pros'], next);
  };
  const addPro = () => updateSectionDetailValue(section.section_key, ['web', 'pros'], [...detail.pros, 'New strength']);
  const removePro = (i: number) =>
    updateSectionDetailValue(section.section_key, ['web', 'pros'], detail.pros.filter((_, idx) => idx !== i));

  return (
    <section className="rounded-xl bg-white p-6 card-shadow">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {(editMode || section.summary_text) && (
        <div className="mt-1.5 text-sm leading-relaxed text-gray-600">
          <EditablePlainText
            value={section.summary_text ?? ''}
            onSave={(v) => updateSectionField(section.section_key, 'summary_text', v)}
            placeholder="Section summary…"
          />
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Screenshot with markers */}
        <div>
          {shown ? (
            <>
              <div className="mb-2 flex items-center justify-end gap-1">
                {hasDesktop && (
                  <button
                    type="button"
                    onClick={() => setViewport('desktop')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${viewport === 'desktop' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    <Monitor className="h-3.5 w-3.5" /> Desktop
                  </button>
                )}
                {hasMobile && (
                  <button
                    type="button"
                    onClick={() => setViewport('mobile')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${viewport === 'mobile' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    <Smartphone className="h-3.5 w-3.5" /> Mobile
                  </button>
                )}
              </div>
              <div className="max-h-[560px] overflow-y-auto rounded-lg">
                <div className="cursor-zoom-in" onClick={() => setLightbox(shown.screenshot_url)}>
                  <WebHighlightLayer imageUrl={shown.screenshot_url as string} alt={`${title} (${viewport})`} markers={markers} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
              No screenshot captured
            </div>
          )}

          {/* Pros */}
          {(editMode || detail.pros.length > 0) && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">What works</p>
              <ul className="mt-1.5 space-y-1">
                {detail.pros.map((pro, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="flex-1">
                      <EditablePlainText value={pro} onSave={(v) => setPro(i, v)} />
                    </span>
                    {editMode && (
                      <button type="button" onClick={() => removePro(i)} className="text-gray-300 hover:text-red-500" aria-label="Remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {editMode && (
                <button type="button" onClick={addPro} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline">
                  <Plus className="h-3 w-3" /> Add strength
                </button>
              )}
            </div>
          )}
        </div>

        {/* Findings with crop cards */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Findings</p>
          {visibleFindings.length === 0 && !editMode && (
            <p className="text-sm text-gray-400">No issues flagged on this page.</p>
          )}
          {visibleFindings.map(({ f, number }) => {
            const i = number - 1;
            const cropShot = f.highlight ? byId.get(f.highlight.snapshot_id) : null;
            return (
              <div key={i} className={`rounded-lg border border-gray-100 p-3 ${f.hidden ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-[11px] font-bold text-brand-primary">
                    {number}
                  </span>
                  <div className="min-w-0 flex-1 text-sm text-gray-800">
                    <EditablePlainText value={f.text} onSave={(v) => setFinding(i, 'text', v)} placeholder="Finding…" />
                  </div>
                  {editMode && (
                    <button type="button" onClick={() => removeFinding(i)} className="text-gray-300 hover:text-red-500" aria-label="Remove finding">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {f.highlight && cropShot?.screenshot_url && (
                  <div className="relative mt-2 pl-7">
                    <WebCropCard index={number} imageUrl={cropShot.screenshot_url} highlight={f.highlight} />
                    {editMode && (
                      <button
                        type="button"
                        onClick={() => removeFindingHighlight(i)}
                        className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-400 shadow hover:text-red-500"
                        aria-label="Remove highlight"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {(editMode || f.recommendation) && (
                  <div className="mt-2 pl-7 text-sm text-gray-600">
                    <span className="font-medium text-gray-700">Fix: </span>
                    <EditablePlainText value={f.recommendation} onSave={(v) => setFinding(i, 'recommendation', v)} placeholder="Recommendation…" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommendations (reuses the editable key-findings block) */}
      <div className="mt-5">
        <ReportSectionKeyFindings
          scope={{ kind: 'audit_section', sectionKey: section.section_key }}
          title="Recommendations"
          items={section.key_findings?.items ?? []}
          itemsHidden={section.key_findings?.items_hidden ?? []}
        />
      </div>

      {lightbox && <ImageLightbox src={lightbox} alt={title} onClose={() => setLightbox(null)} />}
    </section>
  );
}
