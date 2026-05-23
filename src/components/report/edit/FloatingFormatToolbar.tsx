import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Send, Users, Workflow } from 'lucide-react';
import { ENTITY_LABELS, type EntityType } from '../../../lib/entity-tags';

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
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 300);
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

const ENTITY_BUTTONS: { type: EntityType; icon: typeof Workflow; short: string }[] = [
  { type: 'flow', icon: Workflow, short: 'Flow' },
  { type: 'campaign', icon: Send, short: 'Camp.' },
  { type: 'segment', icon: Users, short: 'Seg.' },
];

export default function FloatingFormatToolbar({
  visible,
  top,
  left,
  onBold,
  onItalic,
  onEntityTag,
}: {
  visible: boolean;
  top: number;
  left: number;
  onBold: () => void;
  onItalic: () => void;
  onEntityTag?: (type: EntityType) => void;
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
      {onEntityTag && (
        <>
          <div className="mx-0.5 h-4 w-px bg-gray-200" />
          {ENTITY_BUTTONS.map(({ type, icon: Icon, short }) => (
            <button
              key={type}
              type="button"
              onClick={() => onEntityTag(type)}
              className="rounded px-1.5 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 inline-flex items-center gap-1"
              title={`Tag as ${ENTITY_LABELS[type]}`}
            >
              <Icon className="h-3 w-3" />
              {short}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
