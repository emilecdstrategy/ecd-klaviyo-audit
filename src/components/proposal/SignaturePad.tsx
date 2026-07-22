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
  /** Prefills the typed-signature field (e.g. the signer's name). */
  typedNameDefault?: string;
};

const INK_COLOR = '#1f2937';
const LINE_WIDTH = 2.5;

/** Handwriting fonts for the type-to-sign option. `family` is loaded via the
 * Font Loading API before rendering to canvas; `stack` adds fallbacks for the
 * live DOM preview. Declared in index.html. */
const SIGNATURE_FONTS: { label: string; family: string; stack: string; size: number }[] = [
  { label: 'Signature', family: "'Dancing Script'", stack: "'Dancing Script', cursive", size: 60 },
  { label: 'Formal', family: "'Great Vibes'", stack: "'Great Vibes', cursive", size: 58 },
  { label: 'Casual', family: "'Caveat'", stack: "'Caveat', cursive", size: 56 },
];

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

/** Renders typed text in a handwriting font to a tightly-cropped PNG data URL. */
function typedSignatureDataUrl(text: string, font: { family: string; stack: string; size: number }): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pad = 16;
  const fontSpec = `${font.size}px ${font.stack}`;
  const meas = document.createElement('canvas').getContext('2d');
  if (!meas) return null;
  meas.font = fontSpec;
  const m = meas.measureText(trimmed);
  const ascent = m.actualBoundingBoxAscent || font.size * 0.8;
  const descent = m.actualBoundingBoxDescent || font.size * 0.35;
  const width = Math.max(1, Math.ceil(m.width) + pad * 2);
  const height = Math.max(1, Math.ceil(ascent + descent) + pad * 2);
  const out = document.createElement('canvas');
  out.width = width * dpr;
  out.height = height * dpr;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = INK_COLOR;
  ctx.textBaseline = 'alphabetic';
  ctx.font = fontSpec;
  ctx.fillText(trimmed, pad, pad + ascent);
  return out.toDataURL('image/png');
}

/** Dependency-free signature pad: draw (mouse/touch/stylus) or type a stylized signature. */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { height = 160, onChange, className, typedNameDefault = '' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const modeRef = useRef(mode);
  const [typedText, setTypedText] = useState(typedNameDefault);
  const typedTextRef = useRef(typedText);
  const [fontIndex, setFontIndex] = useState(0);
  const fontIndexRef = useRef(0);

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
    if (!canvas || mode !== 'draw') return;
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
  }, [redraw, mode]);

  // Preload the handwriting fonts so canvas rendering has them available.
  useEffect(() => {
    if (mode !== 'type' || typeof document === 'undefined' || !('fonts' in document)) return;
    for (const f of SIGNATURE_FONTS) {
      document.fonts.load(`${f.size}px ${f.family}`).catch(() => {});
    }
  }, [mode]);

  const notify = useCallback(
    (empty: boolean) => {
      if (modeRef.current === 'draw') setHasInk(!empty);
      onChange?.(empty);
    },
    [onChange],
  );

  const isActiveEmpty = useCallback(
    () => (modeRef.current === 'type' ? typedTextRef.current.trim().length === 0 : strokesRef.current.length === 0),
    [],
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
    if (modeRef.current === 'type') {
      setTypedText('');
      typedTextRef.current = '';
    } else {
      strokesRef.current = [];
      redraw();
    }
    notify(true);
  }, [notify, redraw]);

  const undo = useCallback(() => {
    if (modeRef.current === 'type') return;
    strokesRef.current.pop();
    redraw();
    notify(strokesRef.current.length === 0);
  }, [notify, redraw]);

  const switchMode = (next: 'draw' | 'type') => {
    modeRef.current = next;
    setMode(next);
    notify(isActiveEmpty());
  };

  const onTypedChange = (value: string) => {
    setTypedText(value);
    typedTextRef.current = value;
    notify(value.trim().length === 0);
  };

  const selectFont = (i: number) => {
    setFontIndex(i);
    fontIndexRef.current = i;
  };

  useImperativeHandle(
    ref,
    () => ({
      isEmpty: isActiveEmpty,
      clear,
      undo,
      toDataURL: () => {
        if (modeRef.current === 'type') {
          return typedSignatureDataUrl(typedTextRef.current, SIGNATURE_FONTS[fontIndexRef.current]);
        }
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
    }),
    [clear, undo, isActiveEmpty],
  );

  const activeFont = SIGNATURE_FONTS[fontIndex];

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => switchMode('draw')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
              mode === 'draw' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            Draw
          </button>
          <button
            type="button"
            onClick={() => switchMode('type')}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
              mode === 'type' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            Type
          </button>
        </div>
        {mode === 'draw' && hasInk && (
          <div className="flex gap-2">
            <button type="button" onClick={undo} className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800">Undo</button>
            <button type="button" onClick={clear} className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800">Clear</button>
          </div>
        )}
      </div>

      {mode === 'draw' ? (
        <div className="relative">
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
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={typedText}
            onChange={e => onTypedChange(e.target.value)}
            placeholder="Type your full name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
          <div
            className="flex items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-white px-4"
            style={{ height }}
          >
            {typedText.trim() ? (
              <span
                className="max-w-full truncate leading-none text-gray-800"
                style={{ fontFamily: activeFont.stack, fontSize: activeFont.size }}
              >
                {typedText}
              </span>
            ) : (
              <span className="text-xs text-gray-300">Your signature preview</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SIGNATURE_FONTS.map((f, i) => (
              <button
                key={f.label}
                type="button"
                onClick={() => selectFont(i)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 leading-none transition-colors',
                  i === fontIndex ? 'border-brand-primary bg-brand-primary/5 text-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300',
                )}
                style={{ fontFamily: f.stack, fontSize: 22 }}
                title={f.label}
              >
                {typedText.trim() ? typedText.slice(0, 14) : f.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">Typing your name counts as your legal signature.</p>
        </div>
      )}
    </div>
  );
});

export default SignaturePad;
