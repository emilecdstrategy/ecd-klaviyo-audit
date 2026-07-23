import { useMemo, useState } from 'react';
import { Loader2, Monitor, Plus, Smartphone, Sparkles, Trash2, Wand2 } from 'lucide-react';
import type { AuditSection, WebPageSnapshot } from '../../../lib/types';
import { parseWebSectionDetail } from '../../../lib/web-report-details';
import { generateSectionAfter } from '../../../lib/web-pipeline-status';
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
  const [showAfter, setShowAfter] = useState(false);
  const [afterBusy, setAfterBusy] = useState(false);
  const [afterError, setAfterError] = useState('');
  // Locally overrides the persisted after image right after a (re)generate, so
  // the new concept shows without a full report reload.
  const [afterOverride, setAfterOverride] = useState<{ desktop?: string; mobile?: string }>({});

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
    .map(({ f, number }) => ({ index: number, highlight: f.highlight!, text: f.text, recommendation: f.recommendation }));

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

  // Anchor ids must be unique per section: every section numbers its findings
  // from 1, so a bare `finding-1` would collide across sections and always jump
  // to the first one (the homepage). Scope by section key.
  const findingAnchorId = (number: number) => `finding-${section.section_key}-${number}`;

  const focusFinding = (index: number) => {
    setActiveIndex(index);
    if (typeof document !== 'undefined') {
      document.getElementById(findingAnchorId(index))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const afterUrl = afterOverride[viewport] ?? detail.after_images[viewport]?.url ?? null;
  const displayAfter = showAfter && Boolean(afterUrl);

  const generateAfter = async () => {
    setAfterBusy(true);
    setAfterError('');
    try {
      const res = await generateSectionAfter(section.audit_id, section.section_key, viewport);
      setAfterOverride((prev) => ({ ...prev, [res.viewport]: res.url }));
      if (res.viewport !== viewport) setViewport(res.viewport);
      setShowAfter(true);
    } catch (e) {
      setAfterError(e instanceof Error ? e.message : 'Could not generate the after image.');
    } finally {
      setAfterBusy(false);
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

      {/* Side-by-side: the annotated screenshot sits on the left (sticky while the
          reader scans), with every finding always expanded in a column on the
          right. The numbered pins on the shot match the numbered findings. */}
      <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Left: reference screenshot (before) with optional AI "after" concept */}
        <div className="lg:sticky lg:top-6">
          {shown ? (
            <div className={viewport === 'mobile' ? 'mx-auto w-full max-w-[360px]' : 'w-full'}>
              {/* Before / After toggle (only once an after concept exists) + the
                  editor-only generate control. */}
              {(afterUrl || editMode) && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  {afterUrl ? (
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                      <button
                        type="button"
                        onClick={() => setShowAfter(false)}
                        className={`px-2.5 py-1 text-xs font-medium ${!displayAfter ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      >
                        Before
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAfter(true)}
                        className={`px-2.5 py-1 text-xs font-medium ${displayAfter ? 'bg-brand-primary text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      >
                        After
                      </button>
                    </div>
                  ) : (
                    <span />
                  )}
                  {editMode && (
                    <button
                      type="button"
                      onClick={generateAfter}
                      disabled={afterBusy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/10 disabled:opacity-50"
                    >
                      {afterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {afterBusy ? 'Generating…' : afterUrl ? 'Regenerate after' : 'Generate after'}
                    </button>
                  )}
                </div>
              )}

              {displayAfter && afterUrl ? (
                <div className="relative">
                  <div className="cursor-zoom-in overflow-hidden rounded-lg border border-brand-primary/30" onClick={() => setLightbox(afterUrl)}>
                    <img src={afterUrl} alt={`${title} redesign concept (${viewport})`} className="block w-full" />
                  </div>
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-primary/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
                    <Sparkles className="h-3 w-3" /> AI concept
                  </span>
                  <p className="mt-1.5 text-center text-[11px] text-gray-400">
                    AI-generated concept applying the recommendations. Click to enlarge.
                  </p>
                </div>
              ) : (
                <>
                  {/* No overflow clip here so the pin hover tooltips can extend past
                      the screenshot edges. */}
                  <div
                    className="cursor-zoom-in rounded-lg"
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
                  <p className="mt-1.5 text-center text-[11px] text-gray-400">
                    Click to enlarge{markers.length > 0 ? '. Numbers match the findings.' : ''}
                  </p>
                </>
              )}
              {afterError && <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">{afterError}</p>}
            </div>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
              No screenshot captured
            </div>
          )}
        </div>

        {/* Right: findings, always expanded */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Findings</p>
          {visibleFindings.length === 0 && !editMode ? (
            <p className="mt-2 text-sm text-gray-400">No issues flagged on this page.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {visibleFindings.map(({ f, number }) => {
                const i = number - 1;
                return (
                  <WebFindingCard
                    key={i}
                    anchorId={findingAnchorId(number)}
                    number={number}
                    finding={f}
                    cropShot={null}
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
      </div>

      {lightbox && <ImageLightbox src={lightbox} alt={title} onClose={() => setLightbox(null)} />}
    </section>
  );
}
