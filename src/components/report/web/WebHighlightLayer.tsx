import { ArrowRight } from 'lucide-react';
import type { WebHighlight } from '../../../lib/web-report-details';

type Marker = { index: number; highlight: WebHighlight; text?: string; recommendation?: string };

/** Numbered badges + outline boxes overlaid on a screenshot at %-coordinates. */
export default function WebHighlightLayer({
  imageUrl,
  alt,
  markers,
  activeIndex,
  onMarkerClick,
}: {
  imageUrl: string;
  alt: string;
  markers: Marker[];
  activeIndex?: number | null;
  onMarkerClick?: (index: number) => void;
}) {
  return (
    // No overflow-hidden: pins sit centered on their point and would otherwise be
    // clipped at the screenshot edges. The image keeps its own rounded corners.
    <div className="relative w-full rounded-lg border border-gray-200 bg-white">
      <img src={imageUrl} alt={alt} className="block w-full rounded-lg" loading="lazy" />
      {markers.map(({ index, highlight, text, recommendation }) => {
        const active = activeIndex === index;
        // When the highlighted box is small, a badge centered inside it covers the
        // very element it points at. In that case anchor the badge just outside the
        // box's top-left corner instead of centering it.
        const small = highlight.w <= 16 || highlight.h <= 9;
        const cx = small ? highlight.x : highlight.x + highlight.w / 2;
        const cy = small ? highlight.y : highlight.y + highlight.h / 2;
        const hasTip = Boolean((text && text.trim()) || (recommendation && recommendation.trim()));
        // Open the tooltip above the pin when it sits low on the shot, else below.
        const above = cy > 55;
        return (
          <div key={index}>
            <div
              className={`pointer-events-none absolute rounded-md border-2 transition-colors ${
                active ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-primary/70'
              }`}
              style={{
                left: `${highlight.x}%`,
                top: `${highlight.y}%`,
                width: `${highlight.w}%`,
                height: `${highlight.h}%`,
              }}
            />
            {/* hover:z-50 lifts the whole group (pin + tooltip) above every other
                pin so the tooltip is never painted under a later marker. */}
            <div
              className="group absolute z-20 -translate-x-1/2 -translate-y-1/2 hover:z-50"
              style={{ left: `${cx}%`, top: `${cy}%` }}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMarkerClick?.(index); }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white shadow ring-2 ring-white transition-transform hover:scale-110"
                aria-label={highlight.label || `Finding ${index}`}
              >
                {index}
              </button>
              {hasTip && (
                <div
                  className={`pointer-events-none absolute left-1/2 w-80 max-w-[80vw] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3.5 text-left opacity-0 shadow-xl ring-1 ring-black/5 transition-opacity duration-150 group-hover:opacity-100 ${
                    above ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
                  }`}
                >
                  {text && text.trim() && (
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-[11px] font-bold text-brand-primary">
                        {index}
                      </span>
                      <p className="text-sm leading-relaxed text-gray-800">{text}</p>
                    </div>
                  )}
                  {recommendation && recommendation.trim() && (
                    <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-brand-primary/5 p-2.5">
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />
                      <p className="text-xs leading-relaxed text-gray-600">
                        <span className="font-semibold text-gray-700">Recommended fix: </span>
                        {recommendation}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
