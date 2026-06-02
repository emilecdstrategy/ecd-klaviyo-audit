import { Megaphone } from 'lucide-react';
import type { SectionDemoMarker as SectionDemoMarkerData } from '../../lib/addon-highlight';

export default function SectionDemoMarker({ markers }: { markers: SectionDemoMarkerData[] }) {
  if (!markers.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {markers.map(marker => (
        <div
          key={marker.template_slug}
          className="inline-flex max-w-full items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-left shadow-sm"
          title={marker.presenter_note || `Demo: ${marker.name}`}
        >
          <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-900">Demo: {marker.name}</p>
            {marker.presenter_note ? (
              <p className="mt-0.5 text-[11px] leading-snug text-amber-800/90">{marker.presenter_note}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
