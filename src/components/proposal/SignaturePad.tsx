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

export type SignatureMeta = {
  /** How the signature was produced. */
  mode: 'draw' | 'type';
  /** The typed name (empty for drawn signatures). */
  typed_name: string;
  /** The handwriting font key (empty for drawn signatures). */
  font: string;
};

export type SignaturePadHandle = {
  toDataURL: () => string | null;
  clear: () => void;
  undo: () => void;
  isEmpty: () => boolean;
  getMeta: () => SignatureMeta;
};

type SignaturePadProps = {
  height?: number;
  onChange?: (empty: boolean) => void;
  className?: string;
  /** Controlled typed-signature text (e.g. the name field the parent already
   * collects). When set, type mode renders this live and shows no extra input,
   * so the signer's name is only entered once. */
  typedName?: string;
  /** Uncontrolled initial typed text, used only when `typedName` is not set. */
  typedNameDefault?: string;
  /** Which tab to open on first render. */
  initialMode?: 'draw' | 'type';
};

const INK_COLOR = '#1f2937';
const LINE_WIDTH = 2.5;

/** Single handwriting font used for typed signatures (declared in index.html). */
const TYPE_FONT = { key: 'great-vibes', family: "'Great Vibes'", stack: "'Great Vibes', cursive", size: 48 };

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

/** Renders typed text in the handwriting font to a PNG data URL, sized to the
 * TRUE ink bounds (script swashes extend past the advance width, so measuring
 * with actualBoundingBox avoids clipping trailing flourishes like a final "l"). */
function typedSignatureDataUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pad = 24;
  const fontSpec = `${TYPE_FONT.size}px ${TYPE_FONT.stack}`;
  const meas = document.createElement('canvas').getContext('2d');
  if (!meas) return null;
  meas.font = fontSpec;
  const m = meas.measureText(trimmed);
  const num = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const left = num(m.actualBoundingBoxLeft, 0);
  const right = num(m.actualBoundingBoxRight, m.width);
  const ascent = num(m.actualBoundingBoxAscent, TYPE_FONT.size * 0.8);
  const descent = num(m.actualBoundingBoxDescent, TYPE_FONT.size * 0.4);
  // Place the origin so the leftmost ink sits at `pad`; extend the canvas to the
  // rightmost ink (the swash) plus padding on both sides.
  const originX = pad + Math.max(0, left);
  const width = Math.max(1, Math.ceil(originX + Math.max(right, m.width) + pad));
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
  ctx.fillText(trimmed, originX, pad + ascent);
  return out.toDataURL('image/png');
}

/** Dependency-free signature pad: draw (mouse/touch/stylus) or type a stylized signature. */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { height = 160, onChange, className, typedName, typedNameDefault = '', initialMode = 'draw' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const [mode, setMode] = useState<'draw' | 'type'>(initialMode);
  const modeRef = useRef(mode);
  const controlled = typedName !== undefined;
  const [internalTyped, setInternalTyped] = useState(typedNameDefault);

  // The effective typed text: parent-controlled value if given, else internal.
  const typedValue = controlled ? (typedName as string) : internalTyped;
  const typedValueRef = useRef(typedValue);
  typedValueRef.current = typedValue;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  // Render the live preview from the exact same PNG the signature will save as,
  // so what you see is what gets stored (and it can never clip or overflow).
  // Wait for the handwriting font to load first, then regenerate on each change.
  useEffect(() => {
    if (mode !== 'type') return;
    let cancelled = false;
    const generate = () => { if (!cancelled) setPreviewUrl(typedSignatureDataUrl(typedValueRef.current)); };
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.load(`${TYPE_FONT.size}px ${TYPE_FONT.family}`).then(generate).catch(generate);
    } else {
      generate();
    }
    return () => { cancelled = true; };
  }, [mode, typedValue]);

  const notify = useCallback(
    (empty: boolean) => {
      if (modeRef.current === 'draw') setHasInk(!empty);
      onChange?.(empty);
    },
    [onChange],
  );

  const isActiveEmpty = useCallback(
    () => (modeRef.current === 'type' ? typedValueRef.current.trim().length === 0 : strokesRef.current.length === 0),
    [],
  );

  // Keep the parent's empty-state in sync when the controlled typed value changes.
  useEffect(() => {
    if (modeRef.current === 'type') notify(typedValue.trim().length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedValue]);

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
      if (!controlled) setInternalTyped('');
    } else {
      strokesRef.current = [];
      redraw();
    }
    notify(true);
  }, [controlled, notify, redraw]);

  const undo = useCallback(() => {
    if (modeRef.current === 'type') return;
    strokesRef.current.pop();
    redraw();
    notify(strokesRef.current.length === 0);
  }, [notify, redraw]);

  const switchMode = (next: 'draw' | 'type') => {
    modeRef.current = next;
    setMode(next);
    notify(next === 'type' ? typedValueRef.current.trim().length === 0 : strokesRef.current.length === 0);
  };

  useImperativeHandle(
    ref,
    () => ({
      isEmpty: isActiveEmpty,
      clear,
      undo,
      getMeta: () =>
        modeRef.current === 'type'
          ? { mode: 'type', typed_name: typedValueRef.current.trim(), font: TYPE_FONT.key }
          : { mode: 'draw', typed_name: '', font: '' },
      toDataURL: () => {
        if (modeRef.current === 'type') return typedSignatureDataUrl(typedValueRef.current);
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
          {!controlled && (
            <input
              type="text"
              value={internalTyped}
              onChange={e => setInternalTyped(e.target.value)}
              placeholder="Type your full name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
            />
          )}
          <div
            className="flex items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3"
            style={{ height }}
          >
            {typedValue.trim() && previewUrl ? (
              <img src={previewUrl} alt="Signature preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-gray-300">{controlled ? 'Your signature appears here' : 'Your signature preview'}</span>
            )}
          </div>
          <p className="text-[11px] text-gray-400">Typing your name counts as your legal signature.</p>
        </div>
      )}
    </div>
  );
});

export default SignaturePad;
