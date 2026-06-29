import { useEffect, useRef, useState } from 'react';
import type { SectionDemoMarker as SectionDemoMarkerData } from '../../lib/addon-highlight';
import { getAddOnCategoryStyles } from '../../lib/revenue-addon-categories';
import { cn } from '../../lib/utils';

const VISIBLE_PILL_LIMIT = 3;
const VISIBLE_BEFORE_OVERFLOW = 2;

function truncateName(name: string, max = 22): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function TalkTrackPill({
  marker,
  className,
}: {
  marker: SectionDemoMarkerData;
  className?: string;
}) {
  const styles = getAddOnCategoryStyles(marker.template_slug);
  const tooltip = marker.presenter_note?.trim()
    ? `${marker.name}\n\n${marker.presenter_note.trim()}`
    : marker.name;

  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-tight',
        styles.pillClassName,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', styles.dotClassName)} aria-hidden />
      <span className="truncate">{truncateName(marker.name)}</span>
    </span>
  );
}

function OverflowPopover({
  markers,
  onClose,
}: {
  markers: SectionDemoMarkerData[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
      role="dialog"
      aria-label="Additional talk-track add-ons"
    >
      <ul className="space-y-1">
        {markers.map(marker => (
          <li key={marker.template_slug}>
            <div className="rounded-lg px-2 py-1.5 hover:bg-gray-50">
              <p className="text-xs font-semibold text-gray-900">{marker.name}</p>
              {marker.presenter_note?.trim() ? (
                <p className="mt-0.5 text-[11px] leading-snug text-gray-600">{marker.presenter_note.trim()}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SectionTalkTrackPills({
  markers,
  align = 'end',
  className,
}: {
  markers: SectionDemoMarkerData[];
  align?: 'start' | 'end';
  className?: string;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);

  if (!markers.length) return null;

  const hasOverflow = markers.length > VISIBLE_PILL_LIMIT;
  const visible = hasOverflow ? markers.slice(0, VISIBLE_BEFORE_OVERFLOW) : markers;
  const overflow = hasOverflow ? markers.slice(VISIBLE_BEFORE_OVERFLOW) : [];

  return (
    <div className={cn('relative w-full min-w-0', align === 'end' && 'sm:max-w-[min(100%,22rem)] sm:ml-auto', className)}>
      <div className={cn('flex flex-wrap items-center gap-1.5', align === 'end' ? 'justify-end' : 'justify-start')}>
        <span className="mr-0.5 hidden text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:inline">
          Discuss
        </span>
        {visible.map(marker => (
          <TalkTrackPill key={marker.template_slug} marker={marker} />
        ))}
        {hasOverflow ? (
          <>
            <button
              type="button"
              onClick={() => setOverflowOpen(open => !open)}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
              aria-expanded={overflowOpen}
            >
              +{overflow.length}
            </button>
            {overflowOpen ? (
              <OverflowPopover markers={overflow} onClose={() => setOverflowOpen(false)} />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
