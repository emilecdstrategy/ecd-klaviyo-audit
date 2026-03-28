import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { Annotation, AnnotationSize } from '../../lib/types';

function injectBaseTarget(html: string): string {
  if (/<base\s/i.test(html)) return html;
  const headIdx = html.search(/<head[^>]*>/i);
  if (headIdx !== -1) {
    const closeTag = html.indexOf('>', headIdx) + 1;
    return html.slice(0, closeTag) + '<base target="_blank">' + html.slice(closeTag);
  }
  return '<base target="_blank">' + html;
}

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
  /** Max visible height for HTML emails before scrolling kicks in (default 900) */
  maxHeight?: number;
  /** Marker dot size (default 'md') */
  markerSize?: AnnotationSize;
  /** Always show labels instead of only on hover (default false) */
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);

  const safeSrcDoc = useMemo(() => htmlContent ? injectBaseTarget(htmlContent) : undefined, [htmlContent]);

  useEffect(() => {
    if (!htmlContent || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          setContentHeight(doc.body.scrollHeight + 20);
        }
      } catch { /* cross-origin fallback */ }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [htmlContent]);

  const handleWrapperScroll = useCallback(() => {
    if (wrapperRef.current) {
      setScrollTop(wrapperRef.current.scrollTop);
    }
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || !adding) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;

    if (htmlContent) {
      const clickY = e.clientY - rect.top + (wrapperRef.current?.scrollTop ?? 0);
      const yPct = (clickY / contentHeight) * 100;
      setPendingPos({ x: xPct, y: yPct });
    } else {
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
  const needsScroll = htmlContent && contentHeight > maxHeight;
  const visibleHeight = needsScroll ? maxHeight : contentHeight;

  const renderMarker = (ann: { id: string; x_position: number; y_position: number; label: string }, i: number, isPending?: boolean) => {
    if (htmlContent) {
      const absPx = (ann.y_position / 100) * contentHeight;
      const relPx = absPx - scrollTop;
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

  const renderMarkerInner = (ann: { id: string; label: string }, i: number, isPending?: boolean) => (
    <div className="relative group/marker">
      <div className={`${sz.dot} rounded-full ${isPending ? 'bg-brand-primary animate-pulse' : markerColor} text-white ${sz.dotText} font-bold flex items-center justify-center shadow-lg border-2 border-white`}>
        {isPending ? '?' : i + 1}
      </div>
      {!isPending && (
        <div className={`absolute left-7 top-1/2 -translate-y-1/2 bg-white ${sz.labelPx} ${sz.labelPy} rounded-lg shadow-lg border ${markerBorder} ${sz.labelText} font-medium text-gray-800 whitespace-nowrap ${alwaysShowLabels ? 'opacity-100' : 'opacity-0 group-hover/marker:opacity-100'} transition-opacity pointer-events-none z-20`}>
          {ann.label}
          <div className={`absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-white border-l border-b ${markerBorder} rotate-45`} />
        </div>
      )}
      {!isPending && editable && onRemoveAnnotation && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(ann.id); }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/marker:opacity-100 transition-opacity"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative group">
      {/* Scrollable wrapper for HTML iframes; images don't need it */}
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
          <div className="relative" style={{ height: contentHeight, pointerEvents: adding ? 'none' : undefined }}>
            <iframe
              ref={iframeRef}
              srcDoc={safeSrcDoc}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              title={`${side} email preview`}
              className="w-full border-0 rounded-lg"
              style={{ height: contentHeight, pointerEvents: adding ? 'none' : undefined }}
            />
          </div>
        )}

        {!hasContent && (
          <div className="aspect-[9/16] max-h-[600px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <p className="text-sm text-gray-400">No email content available</p>
          </div>
        )}

        {/* For images, annotations sit inside the normal flow (percentage-based) */}
        {!htmlContent && sideAnnotations.map((ann, i) => renderMarker(ann, i))}
        {!htmlContent && pendingPos && renderMarker(
          { id: 'pending', x_position: pendingPos.x, y_position: pendingPos.y, label: '' },
          0,
          true,
        )}
      </div>

      {/* For HTML emails, annotation overlay sits on top of the scrollable area, synced to scroll */}
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

      {/* Annotation click overlay for HTML in adding mode */}
      {htmlContent && adding && (
        <div
          className="absolute top-0 left-0 right-0 z-[5] cursor-crosshair"
          style={{ height: visibleHeight }}
          onClick={handleClick}
        />
      )}

      {sideAnnotations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {sideAnnotations.map((ann, i) => (
            <div key={ann.id} className="flex items-start gap-2 text-xs">
              <span className={`${sz.listDot} rounded-full ${markerColor} text-white ${sz.listDotText} font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                {i + 1}
              </span>
              <span className="text-gray-600">{ann.label}</span>
            </div>
          ))}
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
