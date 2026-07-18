import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../ui/Toast';
import Modal from '../ui/Modal';
import { createDocumentTemplate, deleteDocumentTemplate, listDocumentTemplates } from '../../lib/documents-db';
import type { DocumentTemplate } from '../../lib/types';

export default function DocumentTemplatesPanel() {
  const navigate = useNavigate();
  const toast = useToast();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);

  const load = () => {
    setLoading(true);
    listDocumentTemplates()
      .then(setTemplates)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load templates'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const template = await createDocumentTemplate({
        name,
        content: '',
        is_active: true,
        display_order: templates.length,
      });
      setCreating(false);
      setNewName('');
      navigate(`/documents/templates/${template.id}/edit`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create template');
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDocumentTemplate(deleteTarget.id);
      setTemplates(prev => prev.filter(t => t.id !== deleteTarget.id));
      toast('Template deleted');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete template');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="animate-slide-up">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Templates</h2>
          <p className="mt-0.5 text-sm text-gray-500">Reusable starting points for new documents.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg gradient-bg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New template
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-white card-shadow" />
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No templates yet. Create one to reuse across documents.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white card-shadow">
          {templates.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-gray-100' : ''}`}
            >
              <FileText className="h-5 w-5 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400">{t.is_active ? 'Active' : 'Inactive'}</p>
              </div>
              <button
                onClick={() => navigate(`/documents/templates/${t.id}/edit`)}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                aria-label="Edit template"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleteTarget(t)}
                className="rounded-lg border border-gray-200 p-2 text-red-500 hover:bg-red-50"
                aria-label="Delete template"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} title="New template" onClose={() => setCreating(false)} className="max-w-md">
        <div className="p-5">
          <label className="block text-xs font-medium text-gray-600">Template name</label>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void create(); }}
            placeholder="e.g. Contractor NDA"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={create} disabled={!newName.trim()} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark disabled:opacity-50">Create & edit</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} title="Delete template?" onClose={() => setDeleteTarget(null)} className="max-w-md">
        <div className="p-5">
          <p className="text-sm text-gray-700">Delete "{deleteTarget?.name}"? Documents already created from it are unaffected.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={remove} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
