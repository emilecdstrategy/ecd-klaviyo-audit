import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_IMAGE_SCALE,
  MAX_IMAGE_SCALE,
  MIN_IMAGE_SCALE,
  normalizeImageScale,
} from '../../lib/report-image-scale';
import { cn } from '../../lib/utils';

const DRAG_THRESHOLD_PX = 4;
const CLICK_SUPPRESS_MS = 400;

type ResizableReportImageProps = {
  src: string;
  alt: string;
  scale?: number | null;
  onScaleChange?: (scale: number) => void;
  resizable?: boolean;
  onClick?: () => void;
  className?: string;
  imageClassName?: string;
};

function ResizeEdge({
  edge,
  onStart,
}: {
  edge: 'left' | 'right';
  onStart: (event: ReactPointerEvent<HTMLDivElement>, edge: 'left' | 'right') => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize image from ${edge} edge`}
      onPointerDown={event => onStart(event, edge)}
      className={cn(
        'absolute inset-y-0 z-20 flex w-10 cursor-ew-resize items-center justify-center touch-none',
        edge === 'left' ? 'left-0 border-l-2 border-transparent hover:border-brand-primary/40 hover:bg-brand-primary/10' : 'right-0 border-r-2 border-transparent hover:border-brand-primary/40 hover:bg-brand-primary/10',
        'group/edge',
      )}
    >
      <div
        className={cn(
          'flex h-16 w-1.5 flex-col items-center justify-center gap-1 rounded-full',
          'bg-brand-primary/25 shadow-sm ring-1 ring-brand-primary/30',
          'opacity-70 transition-opacity group-hover/edge:opacity-100',
        )}
      >
        <span className="h-1 w-1 rounded-full bg-brand-primary" />
        <span className="h-1 w-1 rounded-full bg-brand-primary" />
        <span className="h-1 w-1 rounded-full bg-brand-primary" />
      </div>
    </div>
  );
}

export default function ResizableReportImage({
  src,
  alt,
  scale: scaleProp,
  onScaleChange,
  resizable = false,
  onClick,
  className,
  imageClassName,
}: ResizableReportImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressClickUntilRef = useRef(0);
  const scale = normalizeImageScale(scaleProp);
  const isResizable = resizable && Boolean(onScaleChange);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, edge: 'left' | 'right') => {
      if (!isResizable || !onScaleChange || !containerRef.current) return;
      event.preventDefault();
      event.stopPropagation();

      const containerWidth = containerRef.current.offsetWidth;
      if (containerWidth <= 0) return;

      const startX = event.clientX;
      const startScale = scale;
      let dragged = false;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        if (!dragged && Math.abs(deltaX) >= DRAG_THRESHOLD_PX) {
          dragged = true;
        }
        if (!dragged) return;

        const signedDelta = edge === 'right' ? deltaX : -deltaX;
        const nextScale = Math.min(
          MAX_IMAGE_SCALE,
          Math.max(MIN_IMAGE_SCALE, startScale + (signedDelta * 2) / containerWidth),
        );
        onScaleChange(Number(nextScale.toFixed(3)));
      };

      const finish = () => {
        if (dragged) {
          suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
        }
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [isResizable, onScaleChange, scale],
  );

  const handlePreviewClick = useCallback(() => {
    if (Date.now() < suppressClickUntilRef.current) return;
    onClick?.();
  }, [onClick]);

  const frameClassName = cn(
    'w-full overflow-hidden rounded-xl border border-gray-100 bg-gray-50',
    isResizable && 'ring-1 ring-brand-primary/15',
  );

  const imageBlock = (
    <div className="flex w-full justify-center">
      <div
        className="relative max-w-full"
        style={{ width: `${scale * 100}%` }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          className={cn('pointer-events-none block h-auto w-full select-none object-contain', imageClassName)}
        />
        {isResizable ? (
          <>
            <ResizeEdge edge="left" onStart={startResize} />
            <ResizeEdge edge="right" onStart={startResize} />
          </>
        ) : null}
      </div>
    </div>
  );

  if (onClick && !isResizable) {
    return (
      <div ref={containerRef} className={cn('w-full', className)}>
        <button
          type="button"
          onClick={handlePreviewClick}
          className={cn(frameClassName, 'block w-full text-left')}
          aria-label={alt}
        >
          {imageBlock}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('w-full', className)}>
      <div className={frameClassName}>
        {imageBlock}
      </div>
    </div>
  );
}

export { DEFAULT_IMAGE_SCALE };
