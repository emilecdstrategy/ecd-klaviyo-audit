import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { getDocument, updateDocument } from '../lib/documents-db';
import { buildDocumentSnapshot, sanitizeCopy, type DocDraftPayload, type DocEditPayload } from '../lib/document-agent';
import { DocumentAgentProvider } from '../components/document/agent/DocumentAgentContext';
import { DocumentAgentLayout, DocAgentToggleButton } from '../components/document/agent/DocumentAgentLayout';
import SimpleRichEditor from '../components/ui/SimpleRichEditor';
import type { Document } from '../lib/types';

type SaveStatus = 'idle' | 'saving' | 'saved';

function EditorInner({ initial }: { initial: Document }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const latest = useRef({ title: initial.title, content: initial.content });
  const timer = useRef<number | null>(null);

  const scheduleSave = (next: { title?: string; content?: string }) => {
    latest.current = { ...latest.current, ...next };
    setSaveStatus('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        await updateDocument(initial.id, { title: latest.current.title, content: latest.current.content });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      }
    }, 800);
  };

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <DocumentAgentProvider
      defaultOpen={typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches}
      config={{
        documentId: initial.id,
        getSnapshot: () => buildDocumentSnapshot({ ...initial, title: latest.current.title, content: latest.current.content }),
        onApplyEdits: async (edits: DocEditPayload) => {
          const clean = sanitizeCopy(edits.content);
          setContent(clean);
          scheduleSave({ content: clean });
        },
        // In edit mode the assistant may return a full draft (e.g. for an empty
        // document); apply it as the document's title + body.
        onApplyDraft: async (draft: DocDraftPayload) => {
          const cleanTitle = sanitizeCopy(draft.title);
          const cleanContent = sanitizeCopy(draft.content);
          setTitle(cleanTitle);
          setContent(cleanContent);
          scheduleSave({ title: cleanTitle, content: cleanContent });
        },
      }}
    >
      <DocumentAgentLayout>
        <div>
          <header className="flex h-16 items-center gap-3 border-b border-gray-100 bg-white px-6">
            <button onClick={() => navigate(`/documents/${initial.id}`)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
              placeholder="Untitled document"
              className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold text-gray-900 outline-none placeholder:text-gray-300"
            />
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              {saveStatus === 'saving' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : saveStatus === 'saved' ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Saved</> : null}
            </span>
            <DocAgentToggleButton />
          </header>

          <div className="mx-auto max-w-3xl px-6 py-8">
            <SimpleRichEditor
              value={content}
              onChange={v => { setContent(v); scheduleSave({ content: v }); }}
              rows={24}
              entityTags={false}
              autoTagEntities={false}
              richBlocks
              placeholder="Write your document here, or use the AI assistant to draft it…"
            />
          </div>
        </div>
      </DocumentAgentLayout>
    </DocumentAgentProvider>
  );
}

export default function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    getDocument(id)
      .then(d => {
        if (!d) { setError('Document not found'); return; }
        if (d.signed_at) { navigate(`/documents/${id}`, { replace: true }); return; }
        setDoc(d);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load document'));
  }, [id, navigate]);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!doc) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  return <EditorInner key={doc.id} initial={doc} />;
}
