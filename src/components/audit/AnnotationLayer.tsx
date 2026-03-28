import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { Annotation, AnnotationSize } from '../../lib/types';

function injectBaseTarget(html: string): string {
  const inject = '<base target="_blank"><style>html,body{margin:0;padding:0;overflow:hidden}</style>';
  if (/<base\s/i.test(html)) {
    const headIdx = html.search(/<head[^>]*>/i);
    if (headIdx !== -1) {
      const closeTag = html.indexOf('>', headIdx) + 1;
      return html.slice(0, closeTag) + '<style>html,body{margin:0;padding:0;overflow:hidden}</style>' + html.slice(closeTag);
    }
    return html;
  }
  const headIdx = html.search(/<head[^>]*>/i);
  if (headIdx !== -1) {
    const closeTag = html.indexOf('>', headIdx) + 1;
    return html.slice(0, closeTag) + inject + html.slice(closeTag);
  }
  return inject + html;
}

/**
 * Fixed internal rendering width for the iframe. By rendering at a constant
 * width and CSS-scaling to fit the container, contentHeight is always the same
 * regardless of the container size. This keeps annotation Y positions consistent
 * between backend and frontend.
 */
const IFRAME_RENDER_WIDTH = 600;

const SIZE_CONFIG: Record<AnnotationSize, { dot: string; dotText: string; listDot: string; listDotText: string; labelPx: string; labelPy: string; labelText: string }> = {
  sm: { dot: 'w-5 h-5', dotText: 'text-[8px]', listDot: 'w-3.5 h-3.5', listDotText: 'text-[7px]', labelPx: 'px-2', labelPy: 'py-1', labelText: 'text-[10px]' },
  md: { dot: 'w-6 h-6', dotText: 'text-[10px]', listDot: 'w-4 h-4', listDotText: 'text-[9px]', labelPx: 'px-2.5', labelPy: 'py-1.5', labelText: 'text-xs' },
  lg: { dot: 'w-8 h-8', dotText: 'text-xs', listDot: 'w-5 h-5', listDotText: 'text-[10px]', labelPx: 'px-3', labelPy: 'py-2', labelText: 'text-sm' },
};

interface AnnotationLayerProps {
  imageUrl?: string;
  htmlContent?: string;
  annotations: Annotation[];
  onAddAnnotation?: (x: number, y: number, label: string) => void;
  onRemoveAnnotation?: (id: string) => void;
  editable?: boolean;
  side: 'current' | 'optimized';
  maxHeight?: number;
  markerSize?: AnnotationSize;
  alwaysShowLabels?: boolean;
}

export default function AnnotationLayer({
  imageUrl,
  htmlContent,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  editable = false,
  side,
  maxHeight = 900,
  markerSize = 'md',
  alwaysShowLabels = false,
}: AnnotationLayerProps) {
  const [adding, setAdding] = useState(false);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState('');
  const [hoveredListId, setHoveredListId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(800);
  const [containerWidth, setContainerWidth] = useState(IFRAME_RENDER_WIDTH);
  const [scrollTop, setScrollTop] = useState(0);

  const safeSrcDoc = useMemo(() => htmlContent ? injectBaseTarget(htmlContent) : undefined, [htmlContent]);

  const scale = containerWidth / IFRAME_RENDER_WIDTH;
  const scaledHeight = contentHeight * scale;

  useEffect(() => {
    if (!htmlContent || !outerRef.current) return;
    const el = outerRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [htmlContent]);

  useEffect(() => {
    if (!htmlContent || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.documentElement) {
          const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
          if (h > 0) setContentHeight(prev => prev !== h ? h : prev);
        }
      } catch { /* cross-origin fallback */ }
    };
    iframe.addEventListener('load', measure);
    const ro = new ResizeObserver(() => { requestAnimationFrame(measure); });
    ro.observe(iframe);
    const retryId = setInterval(measure, 500);
    const stopRetry = setTimeout(() => clearInterval(retryId), 5000);
    return () => { iframe.removeEventListener('load', measure); ro.disconnect(); clearInterval(retryId); clearTimeout(stopRetry); };
  }, [htmlContent]);

  const handleWrapperScroll = useCallback(() => {
    if (wrapperRef.current) {
      setScrollTop(wrapperRef.current.scrollTop);
    }
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || !adding) return;
    const refEl = wrapperRef.current ?? e.currentTarget;
    const rect = refEl.getBoundingClientRect();

    if (htmlContent) {
      const scrollY = wrapperRef.current?.scrollTop ?? 0;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top + scrollY;
      const xPct = (screenX / containerWidth) * 100;
      const yPct = (screenY / scale / contentHeight) * 100;
      setPendingPos({ x: xPct, y: yPct });
    } else {
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      setPendingPos({ x: xPct, y: yPct });
    }
    setLabelText('');
  };

  const confirmAnnotation = () => {
    if (pendingPos && labelText.trim() && onAddAnnotation) {
      onAddAnnotation(pendingPos.x, pendingPos.y, labelText.trim());
      setPendingPos(null);
      setLabelText('');
      setAdding(false);
    }
  };

  const sideAnnotations = annotations.filter(a => a.side === side);
  const markerColor = side === 'current' ? 'bg-red-500' : 'bg-emerald-500';
  const markerBorder = side === 'current' ? 'border-red-500' : 'border-emerald-500';

  const hasContent = imageUrl || htmlContent;
  const needsScroll = htmlContent && scaledHeight > maxHeight;
  const visibleHeight = needsScroll ? maxHeight : scaledHeight;

  const renderMarker = (ann: { id: string; x_position: number; y_position: number; label: string }, i: number, isPending?: boolean) => {
    if (htmlContent) {
      const absPx = (ann.y_position / 100) * contentHeight;
      const screenPx = absPx * scale;
      const relPx = screenPx - scrollTop;
      if (relPx < -20 || relPx > visibleHeight + 20) return null;

      return (
        <div
          key={isPending ? 'pending' : ann.id}
          className="absolute z-10 pointer-events-auto"
          style={{ left: `${ann.x_position}%`, top: `${relPx}px`, transform: 'translate(-50%, -50%)' }}
        >
          {renderMarkerInner(ann, i, isPending)}
        </div>
      );
    }

    return (
      <div
        key={isPending ? 'pending' : ann.id}
        className="absolute z-10 pointer-events-auto"
        style={{ left: `${ann.x_position}%`, top: `${ann.y_position}%`, transform: 'translate(-50%, -50%)' }}
      >
        {renderMarkerInner(ann, i, isPending)}
      </div>
    );
  };

  const sz = SIZE_CONFIG[markerSize];

  const renderMarkerInner = (ann: { id: string; label: string }, i: number, isPending?: boolean) => {
    const isHighlighted = hoveredListId === ann.id;
    const showLabel = alwaysShowLabels || isHighlighted;
    return (
      <div className="relative group/marker">
        <div className={`${sz.dot} rounded-full ${isPending ? 'bg-brand-primary animate-pulse' : markerColor} text-white ${sz.dotText} font-bold flex items-center justify-center shadow-lg border-2 ${isHighlighted ? 'border-brand-primary ring-2 ring-brand-primary/40 scale-125' : 'border-white'} transition-transform`}>
          {isPending ? '?' : i + 1}
        </div>
        {!isPending && editable && onRemoveAnnotation && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(ann.id); }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover/marker:opacity-100 transition-opacity z-[100] pointer-events-auto cursor-pointer shadow-md"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {!isPending && (
          <div className={`absolute left-7 top-1/2 -translate-y-1/2 bg-white ${sz.labelPx} ${sz.labelPy} rounded-lg shadow-lg border ${markerBorder} ${sz.labelText} font-medium text-gray-800 whitespace-nowrap ${showLabel ? 'opacity-100' : 'opacity-0 group-hover/marker:opacity-100'} transition-opacity pointer-events-none z-20`}>
            {ann.label}
            <div className={`absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-white border-l border-b ${markerBorder} rotate-45`} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={outerRef} className="relative group overflow-hidden">
      <div
        ref={wrapperRef}
        className={`relative rounded-lg ${adding ? 'cursor-crosshair' : 'cursor-default'}`}
        onClick={handleClick}
        onScroll={handleWrapperScroll}
        style={htmlContent ? { maxHeight: maxHeight, overflowY: 'auto', overflowX: 'hidden' } : undefined}
      >
        {imageUrl && !htmlContent && (
          <img
            src={imageUrl}
            alt={`${side} state`}
            className="w-full h-auto object-cover rounded-lg"
            draggable={false}
          />
        )}

        {htmlContent && (
          <div className="relative" style={{ width: '100%', height: scaledHeight, overflow: 'hidden', pointerEvents: adding ? 'none' : undefined }}>
            <iframe
              ref={iframeRef}
              srcDoc={safeSrcDoc}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              title={`${side} email preview`}
              className="border-0 rounded-lg"
              style={{
                width: IFRAME_RENDER_WIDTH,
                height: contentHeight,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                pointerEvents: adding ? 'none' : undefined,
              }}
            />
          </div>
        )}

        {!hasContent && (
          <div className="aspect-[9/16] max-h-[600px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <p className="text-sm text-gray-400">No email content available</p>
          </div>
        )}

        {!htmlContent && sideAnnotations.map((ann, i) => renderMarker(ann, i))}
        {!htmlContent && pendingPos && renderMarker(
          { id: 'pending', x_position: pendingPos.x, y_position: pendingPos.y, label: '' },
          0,
          true,
        )}
      </div>

      {htmlContent && (
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none"
          style={{ height: visibleHeight }}
        >
          {sideAnnotations.map((ann, i) => renderMarker(ann, i))}
          {pendingPos && renderMarker(
            { id: 'pending', x_position: pendingPos.x, y_position: pendingPos.y, label: '' },
            0,
            true,
          )}
        </div>
      )}

      {htmlContent && adding && (
        <div
          className="absolute top-0 left-0 right-0 z-[5] cursor-crosshair"
          style={{ height: visibleHeight }}
          onClick={handleClick}
        />
      )}

      {sideAnnotations.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Annotations</p>
          <div className="space-y-1">
            {sideAnnotations.map((ann, i) => (
              <div
                key={ann.id}
                className={`flex items-center gap-2 text-xs px-2 py-1 rounded-md cursor-default transition-colors ${hoveredListId === ann.id ? 'bg-brand-primary/5' : 'hover:bg-gray-50'}`}
                onMouseEnter={() => setHoveredListId(ann.id)}
                onMouseLeave={() => setHoveredListId(null)}
              >
                <span className={`${sz.listDot} rounded-full ${markerColor} text-white ${sz.listDotText} font-bold flex items-center justify-center shrink-0`}>
                  {i + 1}
                </span>
                <span className="text-gray-600">{ann.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {editable && (
        <div className="mt-3">
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-primary bg-brand-primary/5 rounded-lg hover:bg-brand-primary/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Annotation
            </button>
          ) : (
            <div className="space-y-2">
              {pendingPos ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={labelText}
                    onChange={e => setLabelText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmAnnotation()}
                    placeholder="Type label..."
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-brand-primary"
                    autoFocus
                  />
                  <button
                    onClick={confirmAnnotation}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-brand-primary rounded-lg hover:bg-brand-primary-dark transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setPendingPos(null); setAdding(false); }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-xs text-brand-primary font-medium">Click on the {htmlContent ? 'email' : 'image'} to place an annotation marker</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
