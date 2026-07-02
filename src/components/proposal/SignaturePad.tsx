import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/utils';

type Point = { x: number; y: number };

export type SignaturePadHandle = {
  toDataURL: () => string | null;
  clear: () => void;
  undo: () => void;
  isEmpty: () => boolean;
};

type SignaturePadProps = {
  height?: number;
  onChange?: (empty: boolean) => void;
  className?: string;
};

const INK_COLOR = '#1f2937';
const LINE_WIDTH = 2.5;

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], dpr: number) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    if (stroke.length < 3) {
      const p = stroke[0];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
    } else {
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const midX = (stroke[i].x + stroke[i + 1].x) / 2;
        const midY = (stroke[i].y + stroke[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
      }
      const last = stroke[stroke.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Dependency-free canvas signature pad (mouse, touch, stylus via pointer events). */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { height = 160, onChange, className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, strokesRef.current, window.devicePixelRatio || 1);
  }, []);

  // Size the backing store to the container * devicePixelRatio; keep strokes on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  const notify = useCallback(
    (empty: boolean) => {
      setHasInk(!empty);
      onChange?.(empty);
    },
    [onChange],
  );

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointFromEvent(e)]);
    redraw();
    notify(false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    stroke.push(pointFromEvent(e));
    redraw();
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const clear = useCallback(() => {
    strokesRef.current = [];
    redraw();
    notify(true);
  }, [notify, redraw]);

  const undo = useCallback(() => {
    strokesRef.current.pop();
    redraw();
    notify(strokesRef.current.length === 0);
  }, [notify, redraw]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => strokesRef.current.length === 0,
    clear,
    undo,
    toDataURL: () => {
      const strokes = strokesRef.current;
      if (strokes.length === 0) return null;
      // Trim to the ink bounding box (+ padding) for a tight, embeddable PNG.
      const pad = 8;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const stroke of strokes) {
        for (const p of stroke) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const width = Math.max(1, Math.ceil(maxX - minX) + pad * 2);
      const heightPx = Math.max(1, Math.ceil(maxY - minY) + pad * 2);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const out = document.createElement('canvas');
      out.width = width * dpr;
      out.height = heightPx * dpr;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      const shifted = strokes.map(stroke =>
        stroke.map(p => ({ x: p.x - minX + pad, y: p.y - minY + pad })),
      );
      drawStrokes(ctx, shifted, dpr);
      return out.toDataURL('image/png');
    },
  }), [clear, undo]);

  return (
    <div className={cn('relative', className)}>
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: 'none' }}
        className="w-full cursor-crosshair rounded-xl border border-dashed border-gray-300 bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      {!hasInk && (
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-gray-200">
          <p className="pb-1 text-center text-xs text-gray-300">Sign here</p>
        </div>
      )}
      {hasInk && (
        <div className="absolute right-2 top-2 flex gap-2">
          <button
            type="button"
            onClick={undo}
            className="rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-gray-500 shadow-sm hover:text-gray-800"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-gray-500 shadow-sm hover:text-gray-800"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
});

export default SignaturePad;
