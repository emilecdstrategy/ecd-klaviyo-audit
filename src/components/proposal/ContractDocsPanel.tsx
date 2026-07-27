import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCheck2, Plus, Trash2 } from 'lucide-react';
import SimpleRichEditor from '../ui/SimpleRichEditor';
import { useToast, scheduleSavedToast } from '../ui/Toast';
import {
  createContractDocument,
  deleteContractDocument,
  listContractDocuments,
  updateContractDocument,
} from '../../lib/proposals-db';
import type { ContractDocument } from '../../lib/types';

export default function ContractDocsPanel() {
  const toast = useToast();
  const [docs, setDocs] = useState<ContractDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const saveTimers = useRef<Map<string, number>>(new Map());

  const addDocument = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError('');
    try {
      const created = await createContractDocument(name);
      setDocs(prev => [...prev, created]);
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the contract document');
    } finally {
      setCreating(false);
    }
  };

  const removeDocument = async (doc: ContractDocument) => {
    if (!window.confirm(`Delete "${doc.name}"? Proposals already sent keep their copy, but it can no longer be attached to new ones.`)) return;
    setError('');
    try {
      await deleteContractDocument(doc.id);
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the contract document');
    }
  };

  const reload = useCallback(async () => {
    setError('');
    try {
      setLoading(true);
      setDocs(await listContractDocuments());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contract documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  const scheduleSave = (doc: ContractDocument, content: string) => {
    setDocs(prev => prev.map(d => (d.id === doc.id ? { ...d, content } : d)));
    const timers = saveTimers.current;
    const existing = timers.get(doc.id);
    if (existing) window.clearTimeout(existing);
    timers.set(
      doc.id,
      window.setTimeout(async () => {
        timers.delete(doc.id);
        try {
          await updateContractDocument(doc.id, { content });
          scheduleSavedToast(toast, 300);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save contract document');
        }
      }, 800),
    );
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-slide-up">
        <div className="h-64 bg-white rounded-xl card-shadow animate-pulse" />
        <div className="h-64 bg-white rounded-xl card-shadow animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Contract Documents</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Contract language attached to proposals when toggled on. The content is snapshotted into each proposal
          at send time, so editing here never changes what a client already signed.
        </p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{error}</div>}

      {docs.map(doc => (
        <section key={doc.id} className="bg-white rounded-xl card-shadow overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-gray-200 text-brand-primary">
              <FileCheck2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-gray-900">{doc.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Last updated {new Date(doc.updated_at).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => removeDocument(doc)}
              className="shrink-0 rounded-lg p-2 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
              aria-label={`Delete ${doc.name}`}
              title="Delete this contract document"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5">
            <SimpleRichEditor
              value={doc.content}
              onChange={value => scheduleSave(doc, value)}
              rows={14}
              placeholder={`Paste the full ${doc.name} text here. Formatting (headings, bold, lists) is preserved on the proposal.`}
              entityTags={false}
              autoTagEntities={false}
            />
          </div>
        </section>
      ))}

      <section className="rounded-xl bg-white p-5 card-shadow">
        <h3 className="text-sm font-semibold text-gray-900">Add a contract document</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Give it a name, then paste the text below. New documents start empty and are available to attach to any
          proposal straight away.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDocument();
              }
            }}
            placeholder="e.g. Data Processing Agreement"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={addDocument}
            disabled={!newName.trim() || creating}
            className="inline-flex items-center gap-1.5 rounded-lg gradient-bg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Adding…' : 'Add document'}
          </button>
        </div>
      </section>
    </div>
  );
}
