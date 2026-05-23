import { useEffect, useRef, useState } from 'react';
import { hasRichAuditMarkup, htmlToMd, mdToHtml } from '../../../lib/audit-markdown';
import { wrapSelectionAsEntity } from '../../../lib/entity-editor';
import type { EntityType } from '../../../lib/entity-tags';
import { cn } from '../../../lib/utils';
import { renderInlineMarkdown } from '../../ui/RichAuditText';
import FloatingFormatToolbar, { useFloatingToolbarPosition } from './FloatingFormatToolbar';
import { useReportEdit } from './ReportEditContext';
import { useReportEntities } from './ReportEntityContext';

type EditablePlainTextProps = {
  value: string;
  onSave?: (value: string) => void;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p';
  placeholder?: string;
  rich?: boolean;
};

function hasRichMarkup(html: string) {
  return hasRichAuditMarkup(html);
}

export default function EditablePlainText({
  value,
  onSave,
  className,
  as: Tag = 'span',
  placeholder,
  rich = false,
}: EditablePlainTextProps) {
  const { editMode } = useReportEdit();
  const { entityLookup, autoTagEntities } = useReportEntities();
  const ref = useRef<HTMLElement>(null);
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const isInternal = useRef(false);
  const toolbarPos = useFloatingToolbarPosition(ref, focused && rich);

  useEffect(() => {
    if (isInternal.current) {
      isInternal.current = false;
      return;
    }
    setLocal(value);
    if (ref.current && editMode && onSave) {
      ref.current.innerHTML = hasRichAuditMarkup(value) ? mdToHtml(value) : (value || '');
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

  const tagEntity = (type: EntityType) => {
    if (wrapSelectionAsEntity(ref.current, type)) {
      ref.current?.focus();
      persist();
    }
  };

  if (!canEdit) {
    if (rich && hasRichAuditMarkup(value)) {
      return (
        <Tag className={className}>
          {renderInlineMarkdown(value, entityLookup, autoTagEntities)}
        </Tag>
      );
    }
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
          rich && '[&_.entity-tag]:pointer-events-none',
        )}
      >
        {hasRichAuditMarkup(local) ? undefined : local}
      </Tag>
      {rich && (
        <FloatingFormatToolbar
          visible={focused}
          top={toolbarPos.top}
          left={toolbarPos.left}
          onBold={() => exec('bold')}
          onItalic={() => exec('italic')}
          onEntityTag={tagEntity}
        />
      )}
    </>
  );
}
