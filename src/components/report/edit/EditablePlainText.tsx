import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { useReportEdit } from './ReportEditContext';

type EditablePlainTextProps = {
  value: string;
  onSave?: (value: string) => void;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  placeholder?: string;
};

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
  const isInternal = useRef(false);

  useEffect(() => {
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    setLocal(value);
  }, [value]);

  const canEdit = editMode && Boolean(onSave);

  if (!canEdit) {
    return <Tag className={className}>{value}</Tag>;
  }

  return (
    <Tag
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      data-placeholder={placeholder}
      onBlur={() => {
        const next = (ref.current?.textContent ?? '').trim();
        if (next !== value) onSave?.(next);
        isInternal.current = true;
        setLocal(next);
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
      {local}
    </Tag>
  );
}
