import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Trash2, X } from 'lucide-react';
import type { WebFinding } from '../../../lib/web-report-details';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import WebHighlightLayer from './WebHighlightLayer';

export type AnnotatedItem = {
  number: number;
  finding: WebFinding;
  side: 'left' | 'right';
  onChangeText: (v: string) => void;
  onChangeRecommendation: (v: string) => void;
  onRemove: () => void;
  onRemoveHighlight: () => void;
  onToggleHidden: () => void;
};

type Line = { number: number; x1: number; y1: number; x2: number; y2: number };

/**
 * Desktop-only annotated screenshot: numbered pins on the shot are connected by
 * lines to callout boxes flanking it (left/right, chosen by the pin's side).
 * Replaces per-finding crop cards, the marker plus its explanation are read in
 * one glance. Falls back to a stacked list on small screens (handled by the
 * caller); this component hides itself below the `lg` breakpoint.
 */
export default function WebAnnotatedScreenshot({
  imageUrl,
  alt,
  midWidth,
  items,
  activeIndex,
  setActiveIndex,
  onLightbox,
}: {
  imageUrl: string;
  alt: string;
  midWidth: number;
  items: AnnotatedItem[];
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  onLightbox: () => void;
}) {
  const { editMode } = useReportEdit();
  const containerRef = useRef<HTMLDivElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const markers = items
    .filter((it) => it.finding.highlight)
    .map((it) => ({ index: it.number, highlight: it.finding.highlight! }));

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const imageWrap = imageWrapRef.current;
    if (!container || !imageWrap) return;
    const c = container.getBoundingClientRect();
    const img = imageWrap.getBoundingClientRect();
    if (img.width === 0 || img.height === 0) return;
    setSize({ w: c.width, h: c.height });
    const next: Line[] = [];
    for (const it of items) {
      const h = it.finding.highlight;
      const card = cardRefs.current.get(it.number);
      if (!h || !card) continue;
      const b = card.getBoundingClientRect();
      // Pin anchor: the numbered badge sits at (x%, y%) of the image.
      const px = img.left - c.left + (h.x / 100) * img.width;
      const py = img.top - c.top + (h.y / 100) * img.height;
      // Card anchor: the inner edge (toward the image), vertically centered.
      const cardX = it.side === 'left' ? b.right - c.left : b.left - c.left;
      const cardY = b.top - c.top + b.height / 2;
      next.push({ number: it.number, x1: cardX, y1: cardY, x2: px, y2: py });
    }
    setLines(next);
  }, [items]);

  useLayoutEffect(() => {
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    if (imageWrapRef.current) ro.observe(imageWrapRef.current);
    cardRefs.current.forEach((el) => ro.observe(el));
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [recompute]);

  // Recompute once the screenshot has actually loaded (its height defines pin y).
  useEffect(() => {
    const img = imageWrapRef.current?.querySelector('img');
    if (!img) return;
    if ((img as HTMLImageElement).complete) {
      recompute();
      return;
    }
    const onLoad = () => recompute();
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [imageUrl, recompute]);

  const left = items.filter((it) => it.side === 'left');
  const right = items.filter((it) => it.side === 'right');

  const renderCallout = (it: AnnotatedItem) => {
    const active = activeIndex === it.number;
    return (
      <div
        key={it.number}
        ref={(el) => {
          if (el) cardRefs.current.set(it.number, el);
          else cardRefs.current.delete(it.number);
        }}
        onMouseEnter={() => setActiveIndex(it.number)}
        onMouseLeave={() => setActiveIndex(null)}
        className={`w-full max-w-[360px] rounded-xl border bg-white p-3.5 shadow-sm transition-shadow ${
          active ? 'border-brand-primary/50 ring-1 ring-brand-primary/20' : 'border-gray-200'
        } ${it.finding.hidden ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-primary text-[11px] font-bold text-white">
            {it.number}
          </span>
          <div className="min-w-0 flex-1 text-sm text-gray-800">
            <EditablePlainText value={it.finding.text} onSave={it.onChangeText} placeholder="Finding…" />
          </div>
          {editMode && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={it.onToggleHidden}
                className="text-gray-300 hover:text-gray-600"
                aria-label={it.finding.hidden ? 'Show finding' : 'Hide finding'}
                title={it.finding.hidden ? 'Show on report' : 'Hide from report'}
              >
                {it.finding.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={it.onRemoveHighlight}
                className="text-gray-300 hover:text-amber-600"
                aria-label="Remove pin"
                title="Remove the pin (keeps the finding, moves it to the list)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={it.onRemove}
                className="text-gray-300 hover:text-red-500"
                aria-label="Remove finding"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {(editMode || it.finding.recommendation) && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-brand-primary/5 p-2 text-xs text-gray-600">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-gray-700">Fix: </span>
              <EditablePlainText
                value={it.finding.recommendation}
                onSave={it.onChangeRecommendation}
                placeholder="Recommendation…"
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    // Break out of the report's max-w-5xl container so the callout columns can
    // use the empty space on the sides. Centered on the viewport; capped so it
    // never causes horizontal scroll.
    <div
      ref={containerRef}
      className="relative left-1/2 hidden w-[min(1500px,96vw)] -translate-x-1/2 items-start gap-6 lg:grid"
      style={{ gridTemplateColumns: `minmax(0,1fr) ${midWidth}px minmax(0,1fr)` }}
    >
      {/* Left callouts */}
      <div className="flex flex-col items-end gap-3 pt-2">{left.map(renderCallout)}</div>

      {/* Screenshot */}
      <div ref={imageWrapRef} className="cursor-zoom-in" style={{ width: midWidth }} onClick={onLightbox}>
        <WebHighlightLayer
          imageUrl={imageUrl}
          alt={alt}
          markers={markers}
          activeIndex={activeIndex}
          onMarkerClick={(i) => setActiveIndex(i)}
        />
      </div>

      {/* Right callouts */}
      <div className="flex flex-col items-start gap-3 pt-2">{right.map(renderCallout)}</div>

      {/* Connector lines */}
      <svg
        className="pointer-events-none absolute inset-0"
        width={size.w}
        height={size.h}
        style={{ overflow: 'visible' }}
      >
        {lines.map((l) => {
          const active = activeIndex === l.number;
          return (
            <g key={l.number}>
              <line
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                className="stroke-brand-primary"
                strokeWidth={active ? 2 : 1.25}
                strokeOpacity={active ? 0.9 : 0.4}
              />
              <circle cx={l.x2} cy={l.y2} r={active ? 3.5 : 2.5} className="fill-brand-primary" fillOpacity={active ? 0.95 : 0.6} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
