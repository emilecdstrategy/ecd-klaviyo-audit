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
        const cx = highlight.x + highlight.w / 2;
        const cy = highlight.y + highlight.h / 2;
        const hasTip = Boolean((text && text.trim()) || (recommendation && recommendation.trim()));
        // Open the tooltip above the pin when it sits low on the shot, else below.
        const above = cy > 55;
        return (
          <div key={index} className="pointer-events-none absolute inset-0">
            <div
              className={`absolute rounded-md border-2 transition-colors ${
                active ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-primary/70'
              }`}
              style={{
                left: `${highlight.x}%`,
                top: `${highlight.y}%`,
                width: `${highlight.w}%`,
                height: `${highlight.h}%`,
              }}
            />
            <div
              className="group pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${cx}%`, top: `${cy}%` }}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMarkerClick?.(index); }}
                className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white shadow ring-2 ring-white transition-transform hover:scale-110"
                aria-label={highlight.label || `Finding ${index}`}
              >
                {index}
              </button>
              {hasTip && (
                <div
                  className={`pointer-events-none absolute left-1/2 z-30 w-72 max-w-[80vw] -translate-x-1/2 rounded-xl bg-gray-900 p-3.5 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 ${
                    above ? 'bottom-full mb-2' : 'top-full mt-2'
                  }`}
                >
                  {text && text.trim() && (
                    <p className="text-xs font-medium leading-relaxed text-white">{text}</p>
                  )}
                  {recommendation && recommendation.trim() && (
                    <p className="mt-2 border-t border-white/15 pt-2 text-xs leading-relaxed text-white/80">
                      <span className="font-semibold text-white">Fix: </span>
                      {recommendation}
                    </p>
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
