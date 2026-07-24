import { useEffect, useMemo, useState } from 'react';
import { Loader2, Monitor, Plus, Smartphone, Trash2, Wand2 } from 'lucide-react';
import type { AuditSection, WebPageSnapshot } from '../../../lib/types';
import { parseWebSectionDetail } from '../../../lib/web-report-details';
import { fetchSectionAfterImages, generateSectionAfter } from '../../../lib/web-pipeline-status';
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
  // Default to mobile (most storefront traffic is mobile), falling back to
  // desktop only when there is no successful mobile shot.
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>(() =>
    snapshots.some((s) => s.viewport === 'mobile' && s.status === 'success' && s.screenshot_url) ? 'mobile' : 'desktop',
  );
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [afterBusy, setAfterBusy] = useState(false);
  const [afterError, setAfterError] = useState('');
  // Locally overrides the persisted after image right after a (re)generate, so
  // the new concept shows without a full report reload.
  const [afterOverride, setAfterOverride] = useState<{ desktop?: string; mobile?: string }>({});

  // "After" images are generated ~1-2 min AFTER analysis completes (the report is
  // viewable before they finish). Poll briefly so they appear on their own without
  // a manual refresh. Stops once both viewports have one, or after ~3 minutes.
  useEffect(() => {
    const PAGE_KEYS = ['web_homepage', 'web_product_page', 'web_collection_page', 'web_cart'];
    if (!PAGE_KEYS.includes(section.section_key)) return;
    const d0 = parseWebSectionDetail(section.section_details).after_images;
    if (d0.desktop?.url && d0.mobile?.url) return; // already have both
    let tries = 0;
    let cancelled = false;
    const id = window.setInterval(async () => {
      tries += 1;
      let imgs: { desktop?: string; mobile?: string } = {};
      try {
        imgs = await fetchSectionAfterImages(section.id);
      } catch { /* transient, keep polling */ }
      if (cancelled) return;
      if (imgs.desktop || imgs.mobile) {
        setAfterOverride((prev) => ({ desktop: prev.desktop ?? imgs.desktop, mobile: prev.mobile ?? imgs.mobile }));
      }
      const haveD = Boolean(imgs.desktop || d0.desktop?.url);
      const haveM = Boolean(imgs.mobile || d0.mobile?.url);
      if ((haveD && haveM) || tries >= 18) window.clearInterval(id);
    }, 10000);
    return () => { cancelled = true; window.clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, section.section_key]);

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

  // Show only the findings for the selected viewport (plus ones tagged 'both'),
  // then renumber 1..M within that filtered set so the pins on the shot match the
  // list. origIndex tracks the real position in detail.findings for edits.
  const visibleFindings = detail.findings
    .map((f, origIndex) => ({ f, origIndex }))
    .filter(({ f }) => editMode || !f.hidden)
    .filter(({ f }) => f.viewport === 'both' || f.viewport === viewport)
    .map((item, idx) => ({ ...item, number: idx + 1 }));

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
    const next = [...detail.findings, { text: '', recommendation: '', viewport, highlight: null, hidden: false }];
    updateSectionDetailValue(section.section_key, ['web', 'findings'], next);
  };
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
  // Both Before and After are always shown together when an after exists: mobile
  // side-by-side (narrow shots), desktop stacked (before above, after below). No
  // toggle needed.
  const twoUp = viewport === 'mobile';

  const generateAfter = async () => {
    setAfterBusy(true);
    setAfterError('');
    try {
      const res = await generateSectionAfter(section.audit_id, section.section_key, viewport);
      setAfterOverride((prev) => ({ ...prev, [res.viewport]: res.url }));
      if (res.viewport !== viewport) setViewport(res.viewport);
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

      {/* Viewport toggle (mobile first, it is the default and most storefront traffic) */}
      {shown && (hasDesktop || hasMobile) && (
        <div className="mt-4 flex items-center justify-end gap-1">
          {hasMobile && (
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${viewport === 'mobile' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Smartphone className="h-3.5 w-3.5" /> Mobile
            </button>
          )}
          {hasDesktop && (
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${viewport === 'desktop' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Monitor className="h-3.5 w-3.5" /> Desktop
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
            <div className={afterUrl || viewport === 'desktop' ? 'w-full' : 'mx-auto w-full max-w-[360px]'}>
              {/* Editor-only generate / regenerate control. */}
              {editMode && (
                <div className="mb-2 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={generateAfter}
                    disabled={afterBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-brand-primary/30 bg-brand-primary/5 px-2.5 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/10 disabled:opacity-50"
                  >
                    {afterBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                    {afterBusy ? 'Generating…' : afterUrl ? 'Regenerate after' : 'Generate after'}
                  </button>
                </div>
              )}

              {afterUrl ? (
                // Show Before and After together: mobile side-by-side (narrow shots),
                // desktop stacked (Before above, After below) so both are visible
                // without a toggle.
                <div className={twoUp ? 'grid grid-cols-2 items-start gap-3' : 'space-y-4'}>
                  {/* Before (with the numbered pins) */}
                  <div>
                    <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">Before</p>
                    <div
                      className="cursor-zoom-in rounded-lg"
                      onClick={() => setLightbox(fullForLightbox?.screenshot_url ?? shown.screenshot_url)}
                    >
                      <WebHighlightLayer
                        imageUrl={shown.screenshot_url as string}
                        alt={`${title} (before)`}
                        markers={markers}
                        activeIndex={activeIndex}
                        onMarkerClick={focusFinding}
                      />
                    </div>
                  </div>
                  {/* After (AI concept) */}
                  <div>
                    <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-brand-primary">After</p>
                    <div className="cursor-zoom-in overflow-hidden rounded-lg border border-brand-primary/30" onClick={() => setLightbox(afterUrl)}>
                      <img src={afterUrl} alt={`${title} redesign concept`} className="block w-full" />
                    </div>
                  </div>
                </div>
              ) : (
                // No overflow clip here so the pin hover tooltips can extend past
                // the screenshot edges.
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
              {visibleFindings.map(({ f, number, origIndex }) => {
                const i = origIndex;
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
