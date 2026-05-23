import { useCallback, useEffect, useRef, useState } from 'react';
import { htmlToMd, mdToHtml } from '../../../lib/audit-markdown';
import { cn } from '../../../lib/utils';
import { RichAuditText } from '../../ui/RichAuditText';
import FloatingFormatToolbar, { useFloatingToolbarPosition } from './FloatingFormatToolbar';
import { useReportEdit } from './ReportEditContext';

type EditableRichTextProps = {
  value: string;
  onSave?: (value: string) => void;
  className?: string;
  placeholder?: string;
  boldFlowNames?: boolean;
  entityNames?: string[];
  singleLine?: boolean;
};

export default function EditableRichText({
  value,
  onSave,
  className,
  placeholder,
  boldFlowNames,
  entityNames,
  singleLine,
}: EditableRichTextProps) {
  const { editMode } = useReportEdit();
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);
  const [focused, setFocused] = useState(false);
  const toolbarPos = useFloatingToolbarPosition(editorRef, focused);

  const canEdit = editMode && Boolean(onSave);

  useEffect(() => {
    if (!canEdit || !editorRef.current || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const html = mdToHtml(value || '');
    if (editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [value, canEdit]);

  const persist = useCallback(() => {
    if (!editorRef.current || !onSave) return;
    isInternalUpdate.current = true;
    onSave(htmlToMd(editorRef.current.innerHTML));
  }, [onSave]);

  const exec = (cmd: string) => {
    document.execCommand(cmd, false);
    editorRef.current?.focus();
    persist();
  };

  if (!canEdit) {
    return (
      <RichAuditText
        text={value}
        className={className}
        boldFlowNames={boldFlowNames}
        entityNames={entityNames}
      />
    );
  }

  return (
    <>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        data-placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          persist();
        }}
        onInput={persist}
        onKeyDown={e => {
          if (singleLine && e.key === 'Enter') {
            e.preventDefault();
            editorRef.current?.blur();
          }
          if (e.key === 'Escape') editorRef.current?.blur();
        }}
        className={cn(
          className,
          'outline-none rounded-md transition-shadow',
          'ring-0 focus:ring-2 focus:ring-brand-primary/30 focus:ring-offset-1',
          'hover:ring-1 hover:ring-brand-primary/20 hover:ring-offset-1',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:pointer-events-none',
        )}
      />
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
