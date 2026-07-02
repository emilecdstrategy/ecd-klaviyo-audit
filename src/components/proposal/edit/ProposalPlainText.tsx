import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { useProposalEdit } from './ProposalEditContext';

type ProposalPlainTextProps = {
  value: string;
  onSave?: (value: string) => void;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  placeholder?: string;
};

/** Plain inline text renderer/editor bound to ProposalEditContext. */
export default function ProposalPlainText({
  value,
  onSave,
  className,
  as: Tag = 'span',
  placeholder,
}: ProposalPlainTextProps) {
  const { editMode } = useProposalEdit();
  const ref = useRef<HTMLElement>(null);
  const [local, setLocal] = useState(value);
  const isInternal = useRef(false);

  useEffect(() => {
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    setLocal(value);
    if (ref.current && editMode && onSave) {
      ref.current.textContent = value || '';
    }
  }, [value, editMode, onSave]);

  const canEdit = editMode && Boolean(onSave);

  const persist = () => {
    if (!ref.current || !onSave) return;
    const next = (ref.current.textContent ?? '').trim();
    if (next !== value) onSave(next);
    isInternal.current = true;
    setLocal(next);
  };

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
      onBlur={persist}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
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
