import { useState, useRef, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import type { Annotation } from '../../lib/types';

interface AnnotationLayerProps {
  imageUrl?: string;
  htmlContent?: string;
  annotations: Annotation[];
  onAddAnnotation?: (x: number, y: number, label: string) => void;
  onRemoveAnnotation?: (id: string) => void;
  editable?: boolean;
  side: 'current' | 'optimized';
}

export default function AnnotationLayer({
  imageUrl,
  htmlContent,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  editable = false,
  side,
}: AnnotationLayerProps) {
  const [adding, setAdding] = useState(false);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(600);

  useEffect(() => {
    if (!htmlContent || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          setIframeHeight(Math.min(doc.body.scrollHeight + 20, 1200));
        }
      } catch { /* cross-origin fallback */ }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [htmlContent]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || !adding) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingPos({ x, y });
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

  return (
    <div className="relative group">
      <div
        className={`relative overflow-hidden rounded-lg ${adding ? 'cursor-crosshair' : 'cursor-default'}`}
        onClick={handleClick}
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
          <div className="relative" style={{ height: iframeHeight }}>
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              sandbox="allow-same-origin"
              title={`${side} email preview`}
              className="w-full h-full border-0 rounded-lg pointer-events-none"
              style={{ height: iframeHeight }}
            />
            {adding && (
              <div className="absolute inset-0 z-[5]" />
            )}
          </div>
        )}

        {!hasContent && (
          <div className="aspect-[9/16] max-h-[600px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
            <p className="text-sm text-gray-400">No email content available</p>
          </div>
        )}

        {sideAnnotations.map((ann, i) => (
          <div
            key={ann.id}
            className="absolute z-10"
            style={{ left: `${ann.x_position}%`, top: `${ann.y_position}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="relative group/marker">
              <div className={`w-6 h-6 rounded-full ${markerColor} text-white text-[10px] font-bold flex items-center justify-center shadow-lg border-2 border-white`}>
                {i + 1}
              </div>
              <div className={`absolute left-7 top-1/2 -translate-y-1/2 bg-white px-2.5 py-1.5 rounded-lg shadow-lg border ${markerBorder} text-xs font-medium text-gray-800 whitespace-nowrap opacity-0 group-hover/marker:opacity-100 transition-opacity pointer-events-none z-20`}>
                {ann.label}
                <div className={`absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-white border-l border-b ${markerBorder} rotate-45`} />
              </div>
              {editable && onRemoveAnnotation && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(ann.id); }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/marker:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {pendingPos && (
          <div
            className="absolute z-20"
            style={{ left: `${pendingPos.x}%`, top: `${pendingPos.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="w-6 h-6 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center shadow-lg border-2 border-white animate-pulse">
              ?
            </div>
          </div>
        )}
      </div>

      {sideAnnotations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {sideAnnotations.map((ann, i) => (
            <div key={ann.id} className="flex items-start gap-2 text-xs">
              <span className={`w-4 h-4 rounded-full ${markerColor} text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
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
