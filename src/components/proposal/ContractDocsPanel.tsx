import { useCallback, useEffect, useRef, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import SimpleRichEditor from '../ui/SimpleRichEditor';
import { useToast, scheduleSavedToast } from '../ui/Toast';
import { listContractDocuments, updateContractDocument } from '../../lib/proposals-db';
import type { ContractDocument } from '../../lib/types';

export default function ContractDocsPanel() {
  const toast = useToast();
  const [docs, setDocs] = useState<ContractDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const saveTimers = useRef<Map<string, number>>(new Map());

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
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">{doc.name}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Last updated {new Date(doc.updated_at).toLocaleDateString()}
              </p>
            </div>
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
    </div>
  );
}
