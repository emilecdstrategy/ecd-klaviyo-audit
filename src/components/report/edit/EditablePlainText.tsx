import { useEffect, useRef, useState } from 'react';
import { htmlToMd, mdToHtml } from '../../../lib/audit-markdown';
import { cn } from '../../../lib/utils';
import FloatingFormatToolbar, { useFloatingToolbarPosition } from './FloatingFormatToolbar';
import { useReportEdit } from './ReportEditContext';

type EditablePlainTextProps = {
  value: string;
  onSave?: (value: string) => void;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  placeholder?: string;
};

function hasRichMarkup(html: string) {
  return /<(b|strong|i|em|u)[>\s/]/i.test(html);
}

function hasMdMarkup(text: string) {
  return /(\*\*|__|\*|_|~~)/.test(text);
}

export default function EditablePlainText({
  value,
  onSave,
  className,
  as: Tag = 'span',
  placeholder,
}: EditablePlainTextProps) {
  const { editMode } = useReportEdit();
  const ref = useRef<HTMLElement>(null);
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const isInternal = useRef(false);
  const toolbarPos = useFloatingToolbarPosition(ref, focused);

  useEffect(() => {
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    setLocal(value);
    if (ref.current && editMode && onSave) {
      ref.current.innerHTML = hasMdMarkup(value) ? mdToHtml(value) : (value || '');
    }
  }, [value, editMode, onSave]);

  const canEdit = editMode && Boolean(onSave);

  const persist = () => {
    if (!ref.current || !onSave) return;
    const html = ref.current.innerHTML;
    const next = hasRichMarkup(html) ? htmlToMd(html) : (ref.current.textContent ?? '').trim();
    if (next !== value) onSave(next);
    isInternal.current = true;
    setLocal(next);
  };

  const exec = (cmd: string) => {
    document.execCommand(cmd, false);
    ref.current?.focus();
    persist();
  };

  if (!canEdit) {
    return <Tag className={className}>{value}</Tag>;
  }

  return (
    <>
      <Tag
        ref={ref as never}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        data-placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          persist();
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') (e.target as HTMLElement).blur();
        }}
        className={cn(
          className,
          'outline-none rounded transition-shadow',
          'focus:ring-2 focus:ring-brand-primary/30 focus:ring-offset-1',
          'hover:ring-1 hover:ring-brand-primary/20 hover:ring-offset-1',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400',
        )}
      >
        {hasMdMarkup(local) ? undefined : local}
      </Tag>
      <FloatingFormatToolbar
        visible={focused}
        top={toolbarPos.top}
        left={toolbarPos.left}
        onBold={() => exec('bold')}
        onItalic={() => exec('italic')}
      />
    </>
  );
}
