import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_IMAGE_SCALE,
  MAX_IMAGE_SCALE,
  MIN_IMAGE_SCALE,
  normalizeImageScale,
} from '../../lib/report-image-scale';
import { cn } from '../../lib/utils';

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
  const scale = normalizeImageScale(scaleProp);

  const startResize = useCallback(
    (edge: 'left' | 'right') => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizable || !onScaleChange || !containerRef.current) return;
      event.preventDefault();
      event.stopPropagation();

      const containerWidth = containerRef.current.offsetWidth;
      if (containerWidth <= 0) return;

      const startX = event.clientX;
      const startScale = scale;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const signedDelta = edge === 'right' ? deltaX : -deltaX;
        const nextScale = Math.min(
          MAX_IMAGE_SCALE,
          Math.max(MIN_IMAGE_SCALE, startScale + (signedDelta * 2) / containerWidth),
        );
        onScaleChange(Number(nextScale.toFixed(3)));
      };

      const onPointerUp = () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [onScaleChange, resizable, scale],
  );

  const inner = (
    <div
      className="relative"
      style={{ width: `${scale * 100}%`, maxWidth: '100%' }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn('block h-auto w-full object-contain', imageClassName)}
      />
      {resizable && onScaleChange ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize image from left edge"
            onPointerDown={startResize('left')}
            className="absolute left-0 top-1/2 z-10 flex h-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-brand-primary/30 bg-white/95 shadow-sm hover:border-brand-primary hover:bg-brand-primary/5"
          >
            <span className="h-4 w-0.5 rounded-full bg-brand-primary/70" />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize image from right edge"
            onPointerDown={startResize('right')}
            className="absolute right-0 top-1/2 z-10 flex h-10 w-3 translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-brand-primary/30 bg-white/95 shadow-sm hover:border-brand-primary hover:bg-brand-primary/5"
          >
            <span className="h-4 w-0.5 rounded-full bg-brand-primary/70" />
          </div>
        </>
      ) : null}
    </div>
  );

  if (onClick) {
    return (
      <div ref={containerRef} className={cn('flex w-full justify-center', className)}>
        <button
          type="button"
          onClick={onClick}
          className="block w-full overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
          aria-label={alt}
        >
          {inner}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex w-full justify-center', className)}>
      <div className="w-full overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
        {inner}
      </div>
    </div>
  );
}

export { DEFAULT_IMAGE_SCALE };
