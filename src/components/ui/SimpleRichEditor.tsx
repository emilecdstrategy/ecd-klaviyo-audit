import { useRef, useCallback, useEffect } from 'react';
import { Bold, Italic, Send, Underline, List, Users, Workflow } from 'lucide-react';
import { htmlToMd, mdToHtml } from '../../lib/audit-markdown';
import { wrapSelectionAsEntity } from '../../lib/entity-editor';
import { ENTITY_LABELS, type EntityType } from '../../lib/entity-tags';

interface SimpleRichEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  entityTags?: boolean;
}

const ENTITY_BUTTONS: { type: EntityType; icon: typeof Workflow; short: string }[] = [
  { type: 'flow', icon: Workflow, short: 'Flow' },
  { type: 'campaign', icon: Send, short: 'Camp.' },
  { type: 'segment', icon: Users, short: 'Seg.' },
];

export default function SimpleRichEditor({
  value,
  onChange,
  rows = 4,
  placeholder,
  entityTags = true,
}: SimpleRichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);

  useEffect(() => {
    if (!editorRef.current || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const html = mdToHtml(value || '');
    if (editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    isInternalUpdate.current = true;
    const md = htmlToMd(editorRef.current.innerHTML);
    onChange(md);
  }, [onChange]);

  const exec = useCallback((cmd: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    handleInput();
  }, [handleInput]);

  const tagEntity = useCallback((type: EntityType) => {
    if (wrapSelectionAsEntity(editorRef.current, type)) {
      editorRef.current?.focus();
      handleInput();
    }
  }, [handleInput]);

  const minH = Math.max(rows * 24, 72);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:border-brand-primary focus-within:ring-1 focus-within:ring-brand-primary/20 transition-colors">
      <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-50 border-b border-gray-200 flex-wrap">
        <ToolbarBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)">
          <Bold className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)">
          <Italic className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)">
          <Underline className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">
          <List className="w-3.5 h-3.5" />
        </ToolbarBtn>
        {entityTags && (
          <>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            {ENTITY_BUTTONS.map(({ type, icon: Icon, short }) => (
              <ToolbarBtn key={type} onClick={() => tagEntity(type)} title={`Tag as ${ENTITY_LABELS[type]}`}>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                  <Icon className="w-3 h-3" />
                  {short}
                </span>
              </ToolbarBtn>
            ))}
          </>
        )}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="px-3 py-2 text-sm text-gray-800 leading-relaxed outline-none [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:ml-4 [&_li]:mb-0.5 empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 [&_.entity-tag]:pointer-events-none"
        style={{ minHeight: minH, maxHeight: 400, overflowY: 'auto' }}
      />
    </div>
  );
}

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
    >
      {children}
    </button>
  );
}
