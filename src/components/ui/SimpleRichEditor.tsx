import { useRef, useCallback, useEffect } from 'react';
import { Bold, Italic, Underline, List } from 'lucide-react';

function mdToHtml(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function htmlToMd(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<u>(.*?)<\/u>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

interface SimpleRichEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}

export default function SimpleRichEditor({
  value,
  onChange,
  rows = 4,
  placeholder,
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

  const minH = Math.max(rows * 24, 72);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:border-brand-primary focus-within:ring-1 focus-within:ring-brand-primary/20 transition-colors">
      <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-50 border-b border-gray-200">
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
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="px-3 py-2 text-sm text-gray-800 leading-relaxed outline-none [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:ml-4 [&_li]:mb-0.5 empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
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
