import { useMemo, useState } from 'react';
import { Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import type { AuditSection, WebPageSnapshot } from '../../../lib/types';
import { parseWebSectionDetail } from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import ImageLightbox from '../../ui/ImageLightbox';
import WebHighlightLayer from './WebHighlightLayer';
import WebFindingCard from './WebFindingCard';

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const successful = snapshots.filter((s) => s.status === 'success' && s.screenshot_url);
  const byId = new Map(successful.map((s) => [s.id, s]));

  // Show the viewport (above-the-fold) shot: it is what the AI annotated, so the
  // marker %-coordinates line up with it. Full-page shots use different heights,
  // so their coords would not map; those open in the lightbox for full context.
  const shown =
    successful.find((s) => s.viewport === viewport && s.variant === 'viewport') ??
    successful.find((s) => s.viewport === viewport && s.variant === 'full') ??
    byId.get(detail.primary_snapshot_id ?? '') ??
    successful[0] ??
    null;
  const fullForLightbox =
    successful.find((s) => s.viewport === viewport && s.variant === 'full') ?? shown;

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
  const addFinding = () => {
    const next = [...detail.findings, { text: '', recommendation: '', highlight: null, hidden: false }];
    updateSectionDetailValue(section.section_key, ['web', 'findings'], next);
  };
  const setPro = (i: number, value: string) => {
    const next = detail.pros.map((p, idx) => (idx === i ? value : p));
    updateSectionDetailValue(section.section_key, ['web', 'pros'], next);
  };
  const addPro = () => updateSectionDetailValue(section.section_key, ['web', 'pros'], [...detail.pros, 'New strength']);
  const removePro = (i: number) =>
    updateSectionDetailValue(section.section_key, ['web', 'pros'], detail.pros.filter((_, idx) => idx !== i));

  const focusFinding = (index: number) => {
    setActiveIndex(index);
    if (typeof document !== 'undefined') {
      document.getElementById(`finding-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

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

      {/* Viewport toggle */}
      {shown && (hasDesktop || hasMobile) && (
        <div className="mt-4 flex items-center justify-end gap-1">
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
      )}

      {/* What works (page-specific strengths) */}
      {(editMode || detail.pros.length > 0) && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">What works</p>
          <ul className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
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

      {/* Full-width reference screenshot for whole-page context. */}
      <div className="mt-5">
        {shown ? (
          <div className={viewport === 'mobile' ? 'mx-auto w-full max-w-[380px]' : 'w-full'}>
            <div className="max-h-[80vh] overflow-y-auto rounded-lg">
              <div
                className="cursor-zoom-in"
                onClick={() => setLightbox(fullForLightbox?.screenshot_url ?? shown.screenshot_url)}
              >
                <WebHighlightLayer
                  imageUrl={shown.screenshot_url as string}
                  alt={`${title} (${viewport})`}
                  markers={markers}
                  activeIndex={activeIndex}
                  onMarkerClick={focusFinding}
                />
              </div>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-gray-400">
              Click to enlarge{markers.length > 0 ? '. Numbers match the findings below.' : ''}
            </p>
          </div>
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
            No screenshot captured
          </div>
        )}
      </div>

      {/* Findings below, in columns. Each shows a zoomed crop of its flagged
          region, so the visual sits with the critique (no scrolling back up). */}
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Findings</p>
        {visibleFindings.length === 0 && !editMode ? (
          <p className="mt-2 text-sm text-gray-400">No issues flagged on this page.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {visibleFindings.map(({ f, number }) => {
              const i = number - 1;
              const cropShot = f.highlight && shown && f.highlight.snapshot_id === shown.id ? shown : null;
              return (
                <WebFindingCard
                  key={i}
                  number={number}
                  finding={f}
                  cropShot={cropShot}
                  active={activeIndex === number}
                  onActivate={(a) => setActiveIndex(a ? number : null)}
                  onChangeText={(v) => setFinding(i, 'text', v)}
                  onChangeRecommendation={(v) => setFinding(i, 'recommendation', v)}
                  onRemove={() => removeFinding(i)}
                  onRemoveHighlight={() => removeFindingHighlight(i)}
                  onToggleHidden={() => setFinding(i, 'hidden', !f.hidden)}
                />
              );
            })}
          </div>
        )}
        {editMode && (
          <button
            type="button"
            onClick={addFinding}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-brand-primary/40 hover:text-brand-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add finding
          </button>
        )}
      </div>

      {lightbox && <ImageLightbox src={lightbox} alt={title} onClose={() => setLightbox(null)} />}
    </section>
  );
}
