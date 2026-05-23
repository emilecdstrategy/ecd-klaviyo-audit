import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic } from 'lucide-react';
import { htmlToMd, mdToHtml } from '../../../lib/audit-markdown';
import { cn } from '../../../lib/utils';
import { RichAuditText } from '../../ui/RichAuditText';
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);
  const [focused, setFocused] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });

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

  const updateToolbarPosition = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setToolbarPos({
      top: Math.max(8, rect.top + window.scrollY - 44),
      left: Math.min(window.innerWidth - 120, rect.left + window.scrollX),
    });
  }, []);

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

  const toolbar = focused && createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-[100] flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1 py-1 shadow-lg"
      style={{ top: toolbarPos.top, left: toolbarPos.left }}
      onMouseDown={e => e.preventDefault()}
    >
      <button type="button" onClick={() => exec('bold')} className="rounded p-1.5 hover:bg-gray-100" title="Bold">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => exec('italic')} className="rounded p-1.5 hover:bg-gray-100" title="Italic">
        <Italic className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  );

  return (
    <>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        data-placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          updateToolbarPosition();
        }}
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
      {toolbar}
    </>
  );
}
