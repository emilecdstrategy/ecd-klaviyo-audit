import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic } from 'lucide-react';

export function useFloatingToolbarPosition(
  anchorRef: RefObject<HTMLElement | null>,
  focused: boolean,
) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const toolbarHeight = 40;
    const gap = 8;
    let top = rect.top - toolbarHeight - gap;
    if (top < 8) top = rect.bottom + gap;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 108);
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    if (!focused) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [focused, updatePosition]);

  return pos;
}

export default function FloatingFormatToolbar({
  visible,
  top,
  left,
  onBold,
  onItalic,
}: {
  visible: boolean;
  top: number;
  left: number;
  onBold: () => void;
  onItalic: () => void;
}) {
  if (!visible) return null;

  return createPortal(
    <div
      className="fixed z-[100] flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-1 shadow-lg"
      style={{ top, left }}
      onMouseDown={e => e.preventDefault()}
    >
      <button type="button" onClick={onBold} className="rounded p-1.5 hover:bg-gray-100" title="Bold (Ctrl+B)">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onItalic} className="rounded p-1.5 hover:bg-gray-100" title="Italic (Ctrl+I)">
        <Italic className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  );
}
