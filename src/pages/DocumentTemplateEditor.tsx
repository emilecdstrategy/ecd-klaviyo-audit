import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { getDocumentTemplate, updateDocumentTemplate } from '../lib/documents-db';
import SimpleRichEditor from '../components/ui/SimpleRichEditor';
import type { DocumentTemplate } from '../lib/types';

type SaveStatus = 'idle' | 'saving' | 'saved';

function EditorInner({ initial }: { initial: DocumentTemplate }) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [active, setActive] = useState(initial.is_active);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const latest = useRef({ name: initial.name, content: initial.content, is_active: initial.is_active });
  const timer = useRef<number | null>(null);

  const scheduleSave = (next: Partial<typeof latest.current>) => {
    latest.current = { ...latest.current, ...next };
    setSaveStatus('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        await updateDocumentTemplate(initial.id, latest.current);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      }
    }, 800);
  };

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <div>
      <header className="flex h-16 items-center gap-3 border-b border-gray-100 bg-white px-6">
        <button onClick={() => navigate('/documents?tab=templates')} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={name}
          onChange={e => { setName(e.target.value); scheduleSave({ name: e.target.value }); }}
          placeholder="Template name"
          className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold text-gray-900 outline-none placeholder:text-gray-300"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={active} onChange={e => { setActive(e.target.checked); scheduleSave({ is_active: e.target.checked }); }} />
          Active
        </label>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          {saveStatus === 'saving' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : saveStatus === 'saved' ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Saved</> : null}
        </span>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <SimpleRichEditor
          value={content}
          onChange={v => { setContent(v); scheduleSave({ content: v }); }}
          rows={24}
          entityTags={false}
          autoTagEntities={false}
          placeholder="Write the template body here…"
        />
      </div>
    </div>
  );
}

export default function DocumentTemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!templateId) return;
    getDocumentTemplate(templateId)
      .then(t => { if (!t) setError('Template not found'); else setTemplate(t); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load template'));
  }, [templateId]);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!template) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  return <EditorInner key={template.id} initial={template} />;
}
