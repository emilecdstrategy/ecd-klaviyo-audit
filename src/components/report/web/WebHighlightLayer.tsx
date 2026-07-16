import type { WebHighlight } from '../../../lib/web-report-details';

type Marker = { index: number; highlight: WebHighlight };

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
    <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
      <img src={imageUrl} alt={alt} className="block w-full" loading="lazy" />
      {markers.map(({ index, highlight }) => {
        const active = activeIndex === index;
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
            <button
              type="button"
              onClick={() => onMarkerClick?.(index)}
              className="pointer-events-auto absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white shadow ring-2 ring-white"
              style={{ left: `${highlight.x}%`, top: `${highlight.y}%` }}
              aria-label={highlight.label || `Finding ${index}`}
              title={highlight.label}
            >
              {index}
            </button>
          </div>
        );
      })}
    </div>
  );
}
